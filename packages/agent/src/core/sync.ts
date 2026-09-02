import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import pg from 'pg'
import { loadEnvSecrets } from './config.js'
import { hashCode, AccessCodeStore } from './access-code.js'
import type { EventStore, EventRecord } from './store.js'
import type { MemoryStore } from './memory.js'
import type { RequestStoreLike } from './delegation.js'

export interface SyncResult {
  skipped: boolean
  synced: number
  error?: string
}

/**
 * Derive a stable UUID from a local record id so mirror rows are idempotent:
 * re-posting the same record merges on the primary key instead of duplicating.
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

function toAgentEventRow(event: EventRecord): unknown[] {
  return [
    deterministicUuid(event.id),
    event.agentId,
    event.mode,
    event.state?.runwayDays ?? 0,
    event.state?.availableUSDFC ?? 0,
    event.state?.spendRateUSDFCPerDay ?? null,
    event.decision?.action ?? 'HOLD',
    event.guardrail?.status ?? 'allow',
    event.execution?.status ?? 'unknown',
    event.execution?.transactionId ?? null,
    event.decision?.reasoning ?? '',
    event.proposalHash ?? '',
    event.policyVersion ?? 1,
    event.state?.source ?? null,
    event.recordedAt
  ]
}

// One shared connection per process; recreated after failures.
let clientPromise: Promise<pg.Client> | null = null
const registeredCodeHashes = new Set<string>()

async function getClient(databaseUrl: string): Promise<pg.Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
      await client.connect()
      return client
    })()
    clientPromise.catch(() => {
      clientPromise = null
    })
  }
  return clientPromise
}

async function registerAccessCode(client: pg.Client, dataDir: string): Promise<{ agentId: string; rawCode: string } | null> {
  const store = new AccessCodeStore(dataDir)
  const record = store.load()
  if (!record) return null

  if (!registeredCodeHashes.has(record.codeHash)) {
    await client.query(
      `insert into agent_codes (agent_id, code_hash)
       values ($1, $2)
       on conflict (code_hash) do update set agent_id = excluded.agent_id`,
      [record.agentId, record.codeHash]
    )
    registeredCodeHashes.add(record.codeHash)

    for (const oldHash of record.previousHashes) {
      await client.query(
        `update agent_codes set revoked_at = now()
         where code_hash = $1 and revoked_at is null`,
        [oldHash]
      )
    }
  }
  return { agentId: record.agentId, rawCode: record.rawCode }
}

/**
 * Optional cloud mirror to Neon (Postgres). Local-first: when
 * FOURIER_DATABASE_URL is absent this is a no-op and all data stays in
 * the local JSONL stores.
 *
 * Pushes, per cycle:
 *   - unsynced events (outbox pattern, deterministic ids)
 *   - all memory records (upserts pick up outcome updates)
 *   - all delegation requests (upserts pick up status changes)
 *   - registers the access code (hashed) and revokes rotated ones
 *
 * The database URL is a server-side secret — never bundled, never logged.
 */
export async function syncEventOutbox(
  store: EventStore,
  options?: {
    databaseUrl?: string
    dataDir?: string
    memory?: MemoryStore
    requests?: RequestStoreLike
    agentId?: string
  }
): Promise<SyncResult> {
  const url = options?.databaseUrl ?? loadEnvSecrets().databaseUrl
  if (!url?.trim()) return { skipped: true, synced: 0 }

  const dataDir = options?.dataDir ?? '.fourier'
  let client: pg.Client
  try {
    client = await getClient(url.trim())
  } catch (err) {
    clientPromise = null
    return { skipped: false, synced: 0, error: `Neon connect failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  let synced = 0
  try {
    const code = await registerAccessCode(client, dataDir)
    const agentId = options?.agentId ?? code?.agentId

    // 0. Agent state snapshot (policy for the online viewer)
    if (agentId) {
      try {
        const { existsSync, readFileSync } = await import('node:fs')
        const policyPath = resolve(dataDir, '..', 'fourier.policy.json')
        if (existsSync(policyPath)) {
          const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
          await client.query(
            `insert into agent_state (agent_id, policy, updated_at)
             values ($1, $2, now())
             on conflict (agent_id) do update set policy = excluded.policy, updated_at = now()`,
            [agentId, JSON.stringify(policy)]
          )
        }
      } catch {
        // policy snapshot is best-effort
      }
    }

    // 1. Events — outbox pattern
    const pending = store.unsynced()
    for (const event of pending) {
      await client.query(
        `insert into agent_events
           (id, agent_id, mode, runway_days, available_usdfc, spend_rate_per_day,
            action, guardrail_status, execution_status, tx_hash, reasoning,
            raw_output_hash, policy_version, source, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (id) do nothing`,
        toAgentEventRow(event)
      )
      synced++
    }
    if (pending.length > 0) store.markSynced(pending.map(e => e.id))

    // 2. Memory — full upsert so outcome updates propagate
    if (options?.memory) {
      for (const record of options.memory.all()) {
        await client.query(
          `insert into agent_memory
             (id, agent_id, action, runway_days_at_decision, amount_if_topup, outcome, created_at)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (id) do update set
             outcome = excluded.outcome,
             runway_days_at_decision = excluded.runway_days_at_decision`,
          [
            deterministicUuid(record.id),
            record.agent_id,
            record.action,
            record.runway_days_at_decision,
            record.amount_if_topup,
            record.outcome,
            record.created_at
          ]
        )
      }
    }

    // 3. Delegation requests — full upsert so status changes propagate
    if (options?.requests) {
      for (const request of await options.requests.all()) {
        await client.query(
          `insert into agent_requests
             (id, requesting_agent_id, treasury_agent_id, requesting_agent_address,
              amount_requested, reason, status, tx_hash, rejection_reason,
              created_at, evaluated_at, settled_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           on conflict (id) do update set
             status = excluded.status,
             tx_hash = excluded.tx_hash,
             rejection_reason = excluded.rejection_reason,
             evaluated_at = excluded.evaluated_at,
             settled_at = excluded.settled_at`,
          [
            request.id,
            request.requesting_agent_id,
            request.treasury_agent_id,
            request.requesting_agent_address ?? null,
            request.amount_requested,
            request.reason,
            request.status,
            request.tx_hash ?? null,
            request.rejection_reason ?? null,
            request.created_at,
            request.evaluated_at ?? null,
            request.settled_at ?? null
          ]
        )
      }
    }

    return { skipped: false, synced }
  } catch (err) {
    clientPromise = null
    return {
      skipped: false,
      synced,
      error: `Neon sync failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}
