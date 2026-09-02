import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { hashCode, normalizeCode } from '../../agent/src/core/access-code.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const publicDir = resolve(__dirname, '../public')

/**
 * Fourier hosted viewer — READ-ONLY, code-gated.
 *
 * The access code is the only credential: no accounts, no passwords.
 * Codes are stored hashed in Neon; this API resolves code -> agent_id and
 * serves that agent's mirrored data. There is no write endpoint, no
 * execution path, and no secret material here by construction.
 */

let clientPromise: Promise<pg.Client> | null = null

function db(): Promise<pg.Client> {
  const url = process.env.FOURIER_DATABASE_URL?.trim()
  if (!url) {
    return Promise.reject(new Error('FOURIER_DATABASE_URL is not configured'))
  }
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
      await client.connect()
      return client
    })()
    clientPromise.catch(() => {
      clientPromise = null
    })
  }
  return clientPromise
}

// ---------- simple in-memory rate limiting (per IP) ----------

const attempts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count++
  return entry.count > max
}

// ---------- auth ----------

async function resolveAgentId(code: string | null): Promise<string | null> {
  if (!code) return null
  const normalized = normalizeCode(code)
  const client = await db()
  const result = await client.query(
    'select agent_id from agent_codes where code_hash = $1 and revoked_at is null limit 1',
    [hashCode(normalized)]
  )
  return result.rows[0]?.agent_id ?? null
}

// ---------- API routes ----------

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const ip = req.socket.remoteAddress ?? 'unknown'
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  // Code verification (stricter rate limit — this is the guessable surface)
  if (url.pathname === '/api/view/auth' && req.method === 'POST') {
    if (rateLimited(`auth:${ip}`, 15, 5 * 60 * 1000)) {
      send(429, { error: 'Too many attempts. Try again in a few minutes.' })
      return
    }
    const body = await readBody(req)
    const rawCode = typeof body?.code === 'string' ? body.code : null
    let agentId: string | null = null
    try {
      agentId = await resolveAgentId(rawCode)
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : 'database unavailable' })
      return
    }
    if (!agentId) {
      send(401, { error: 'Unknown or revoked access code.' })
      return
    }
    send(200, { ok: true, agentId })
    return
  }

  // Data routes (mild rate limit)
  if (url.pathname.startsWith('/api/view/') && rateLimited(`api:${ip}`, 120, 60 * 1000)) {
    send(429, { error: 'Slow down.' })
    return
  }

  const code = req.headers['x-fourier-code'] ?? url.searchParams.get('code')
  let agentId: string | null = null
  try {
    agentId = await resolveAgentId(typeof code === 'string' ? code : null)
  } catch (err) {
    send(500, { error: err instanceof Error ? err.message : 'database unavailable' })
    return
  }
  if (!agentId) {
    send(401, { error: 'Unknown or revoked access code.' })
    return
  }

  try {
    const client = await db()

    if (url.pathname === '/api/view/overview') {
      const events = await client.query(
        `select * from agent_events where agent_id = $1 order by created_at desc limit 20`,
        [agentId]
      )
      const state = await client.query(
        `select policy from agent_state where agent_id = $1`,
        [agentId]
      )
      send(200, {
        agentId,
        policy: state.rows[0]?.policy ?? null,
        events: events.rows
      })
      return
    }

    if (url.pathname === '/api/view/memory') {
      const rows = await client.query(
        `select * from agent_memory where agent_id = $1 order by created_at desc limit 50`,
        [agentId]
      )
      send(200, rows.rows)
      return
    }

    if (url.pathname === '/api/view/requests') {
      const rows = await client.query(
        `select * from agent_requests
         where requesting_agent_id = $1 or treasury_agent_id = $1
         order by created_at desc limit 50`,
        [agentId]
      )
      send(200, rows.rows)
      return
    }

    send(404, { error: 'not found' })
  } catch (err) {
    send(500, { error: err instanceof Error ? err.message : String(err) })
  }
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise(resolveBody => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        resolveBody(JSON.parse(body || '{}'))
      } catch {
        resolveBody({})
      }
    })
  })
}

// ---------- static serving ----------

function getMimeType(filePath: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
  }
  return types[extname(filePath)] ?? 'application/octet-stream'
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url)
    return
  }

  let filePath = join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname)
  if (!existsSync(filePath)) filePath = join(publicDir, 'index.html')

  try {
    const content = readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': getMimeType(filePath), 'Cache-Control': 'no-store' })
    res.end(content)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
})

const PORT = Number(process.env.PORT) || 4000
const HOST = process.env.HOST ?? '127.0.0.1'
server.listen(PORT, HOST, () => {
  console.log(`\nFourier online viewer (read-only) at http://${HOST === '0.0.0.0' ? '<all-interfaces>' : 'localhost'}:${PORT}`)
  console.log(`Database: ${process.env.FOURIER_DATABASE_URL ? 'configured' : 'NOT configured (set FOURIER_DATABASE_URL)'}\n`)
})
