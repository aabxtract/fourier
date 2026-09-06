import pg from 'pg'
import { hashCode, normalizeCode } from './code-utils.js'

/**
 * Shared viewer logic — used by both the local http server (src/server.ts)
 * and the Vercel serverless function (api/view.ts). READ-ONLY: every query
 * here is a SELECT. There is no write path to the cloud from the viewer.
 */

let clientPromise: Promise<pg.Client> | null = null

export function db(): Promise<pg.Client> {
  const url = process.env.FOURIER_DATABASE_URL?.trim()
  if (!url) {
    return Promise.reject(new Error('FOURIER_DATABASE_URL is not configured'))
  }
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
      // Same rule as the agent: a dropped connection degrades, never crashes.
      client.on('error', err => {
        console.warn(`[viewer] Neon connection dropped (will reconnect): ${err instanceof Error ? err.message : String(err)}`)
        clientPromise = null
      })
      await client.connect()
      return client
    })()
    clientPromise.catch(() => {
      clientPromise = null
    })
  }
  return clientPromise
}

export async function resolveAgentId(code: string | null): Promise<string | null> {
  if (!code) return null
  const normalized = normalizeCode(code)
  const client = await db()
  const result = await client.query(
    'select agent_id from agent_codes where code_hash = $1 and revoked_at is null limit 1',
    [hashCode(normalized)]
  )
  return result.rows[0]?.agent_id ?? null
}

export async function getOverview(agentId: string): Promise<{ agentId: string; policy: unknown; events: unknown[] }> {
  const client = await db()
  const events = await client.query(
    'select * from agent_events where agent_id = $1 order by created_at desc limit 20',
    [agentId]
  )
  const state = await client.query('select policy from agent_state where agent_id = $1', [agentId])
  return { agentId, policy: state.rows[0]?.policy ?? null, events: events.rows }
}

export async function getMemory(agentId: string): Promise<unknown[]> {
  const client = await db()
  const rows = await client.query(
    'select * from agent_memory where agent_id = $1 order by created_at desc limit 50',
    [agentId]
  )
  return rows.rows
}

export async function getRequests(agentId: string): Promise<unknown[]> {
  const client = await db()
  const rows = await client.query(
    `select * from agent_requests
     where requesting_agent_id = $1 or treasury_agent_id = $1
     order by created_at desc limit 50`,
    [agentId]
  )
  return rows.rows
}
