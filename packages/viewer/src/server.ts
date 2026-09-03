import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveAgentId, getOverview, getMemory, getRequests } from './logic.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const publicDir = resolve(__dirname, '../public')

/**
 * Fourier hosted viewer — READ-ONLY, code-gated (local version).
 * Vercel deployment of the same logic lives in api/view.ts.
 */

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
    if (url.pathname === '/api/view/overview') {
      send(200, await getOverview(agentId))
      return
    }
    if (url.pathname === '/api/view/memory') {
      send(200, await getMemory(agentId))
      return
    }
    if (url.pathname === '/api/view/requests') {
      send(200, await getRequests(agentId))
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
