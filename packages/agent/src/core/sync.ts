import { createHash } from 'node:crypto'
import { loadEnvSecrets } from './config.js'
import type { EventStore, EventRecord } from './store.js'

export interface SyncResult {
  skipped: boolean
  synced: number
  error?: string
}

/**
 * Derive a stable UUID from a local event id so mirror rows are idempotent:
 * re-posting the same event merges on the primary key instead of duplicating.
 */
function deterministicUuid(input: string): string {
  const hash = createHash('md5').update(input).digest('hex')
  const bytes = hash.split('')
  // Set UUID version 3 (MD5-based) and variant bits per RFC 4122
  bytes[12] = '3'
  bytes[16] = '8'
  const h = bytes.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function toAgentEventRow(event: EventRecord): Record<string, unknown> {
  return {
    id: deterministicUuid(event.id),
    agent_id: event.agentId,
    mode: event.mode,
    runway_days: event.state?.runwayDays ?? 0,
    available_usdfc: event.state?.availableUSDFC ?? 0,
    spend_rate_per_day: event.state?.spendRateUSDFCPerDay ?? null,
    action: event.decision?.action ?? 'HOLD',
    guardrail_status: event.guardrail?.status ?? 'allow',
    execution_status: event.execution?.status ?? 'unknown',
    tx_hash: event.execution?.transactionId ?? null,
    reasoning: event.decision?.reasoning ?? '',
    raw_output_hash: event.proposalHash ?? '',
    policy_version: event.policyVersion ?? 1,
    created_at: event.recordedAt
  }
}

/**
 * Optional remote mirror of the local event outbox. Self-hosted by default:
 * when FOURIER_SUPABASE_URL and FOURIER_SUPABASE_SERVICE_ROLE_KEY are absent,
 * this is a no-op and all data stays in the local JSONL store.
 *
 * The service role key bypasses RLS and must only ever live in the agent's
 * server-side environment — never in the dashboard client or config files.
 */
export async function syncEventOutbox(
  store: EventStore,
  options?: { supabaseUrl?: string; supabaseServiceRoleKey?: string }
): Promise<SyncResult> {
  const secrets = options && (options.supabaseUrl !== undefined || options.supabaseServiceRoleKey !== undefined)
    ? { supabaseUrl: options.supabaseUrl, supabaseServiceRoleKey: options.supabaseServiceRoleKey }
    : loadEnvSecrets()

  const url = secrets.supabaseUrl?.trim()
  const key = secrets.supabaseServiceRoleKey?.trim()
  if (!url || !key) return { skipped: true, synced: 0 }

  const pending = store.unsynced()
  if (pending.length === 0) return { skipped: false, synced: 0 }

  const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/agent_events`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(pending.map(toAgentEventRow))
  })

  if (!response.ok) {
    return {
      skipped: false,
      synced: 0,
      error: `Supabase sync failed: ${response.status} — ${(await response.text()).slice(0, 200)}`
    }
  }

  store.markSynced(pending.map(event => event.id))
  return { skipped: false, synced: pending.length }
}
