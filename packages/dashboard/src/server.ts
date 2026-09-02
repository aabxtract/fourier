import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventStore } from '../../agent/src/core/store.js'
import { MemoryStore } from '../../agent/src/core/memory.js'
import { RequestStore } from '../../agent/src/core/delegation.js'
import { ApprovalStore } from '../../agent/src/core/approvals.js'
import { compilePolicy } from '../../agent/src/core/policy.js'
import { simulate } from '../../agent/src/core/simulate.js'
import { parseConfig, loadEnvSecrets } from '../../agent/src/core/config.js'
import { scenarios } from '../../agent/src/scenarios/index.js'
import type { CompiledPolicy, FourierConfig } from '../../agent/src/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')
const root = resolve(__dirname, '../../..')
const publicDir = resolve(__dirname, '../public')
const dataDir = resolve(root, '.fourier')

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

function loadConfig(): FourierConfig {
  const configPath = resolve(root, 'fourier.config.json')
  if (existsSync(configPath)) {
    try {
      return parseConfig(JSON.parse(readFileSync(configPath, 'utf8')))
    } catch {
      // fallback
    }
  }
  return {
    agentId: 'fourier-demo',
    network: 'calibration',
    role: 'standalone',
    treasuryAgentId: null,
    walletAddress: '0x3b890f912D23c9E32d3F793f63c874b9c1d0bE32',
    model: { provider: 'claude', model: 'claude-3-7-sonnet-latest' },
    thresholds: { warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5 },
    actions: { topUpEnabled: true, triageEnabled: false, triageRequiresApproval: true },
    checkIntervalMinutes: 30
  }
}

function loadPolicy(config: FourierConfig): CompiledPolicy {
  const policyPath = resolve(root, 'fourier.policy.json')
  if (existsSync(policyPath)) {
    try {
      return JSON.parse(readFileSync(policyPath, 'utf8')) as CompiledPolicy
    } catch {
      // fallback
    }
  }
  return {
    version: 1,
    ...config.thresholds,
    ...config.actions,
    datasetPriority: ['customer-ledger', 'audit-archive', 'build-cache']
  }
}

function computeHealth(config: FourierConfig, eventStore: EventStore, approvalStore: ApprovalStore, pendingRequests: number) {
  const secrets = loadEnvSecrets()
  const latest = eventStore.latest(1)[0] ?? null
  const intervalMs = config.checkIntervalMinutes * 60 * 1000
  const ageMs = latest ? Date.now() - new Date(latest.recordedAt).getTime() : null
  const stale = ageMs === null || ageMs > intervalMs * 2.5

  const source = latest?.state?.source
  const pendingApprovals = approvalStore.all().filter(a => a.usedAt === null).length

  return {
    watcher: stale ? 'stale' : 'healthy',
    lastEventAt: latest?.recordedAt ?? null,
    lastEventSource: source ?? null,
    aiProvider: config.model.provider,
    guardrails: 'active',
    channels: {
      telegram: secrets.telegramBotToken ? 'configured' : 'not configured',
      discord: secrets.discordWebhookUrl ? 'configured' : 'not configured',
      webhook: secrets.webhookUrl ? 'configured' : 'not configured'
    },
    delegation: {
      role: config.role,
      pendingRequests,
      coordination: secrets.delegationUrl ? 'remote' : 'local-jsonl'
    },
    sync: secrets.supabaseUrl && secrets.supabaseServiceRoleKey
      ? { mode: 'remote-mirror', pending: eventStore.unsynced().length }
      : { mode: 'local-only', pending: 0 },
    approvalsPending: pendingApprovals
  }
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const pathname = url.pathname

  // CORS: no wildcard. When token auth is enabled the dashboard may be accessed
  // remotely, so the request origin is reflected; otherwise same-origin only.
  const token = process.env.FOURIER_DASHBOARD_TOKEN?.trim()
  if (token && req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Vary', 'Origin')
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // API auth: when FOURIER_DASHBOARD_TOKEN is set, every /api route requires it.
  if (pathname.startsWith('/api/') && token) {
    const provided = req.headers.authorization
    if (provided !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
  }

  // --- API Endpoints ---

  if (pathname === '/api/status' && req.method === 'GET') {
    const config = loadConfig()
    const policy = loadPolicy(config)
    const eventStore = new EventStore(dataDir)
    const latestEvents = eventStore.latest(1)
    const latest = latestEvents.length > 0 ? latestEvents[0] : null
    const pendingRequests = (await new RequestStore(dataDir).all()).filter(r => r.status === 'pending').length

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        config,
        policy,
        latestEvent: latest,
        health: computeHealth(config, eventStore, new ApprovalStore(dataDir), pendingRequests)
      })
    )
    return
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    const eventStore = new EventStore(dataDir)
    const limit = parseInt(url.searchParams.get('limit') || '50', 10)
    const events = eventStore.latest(limit)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(events))
    return
  }

  if (pathname === '/api/memory' && req.method === 'GET') {
    const memoryStore = new MemoryStore(dataDir)
    const records = memoryStore.all()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(records))
    return
  }

  if (pathname === '/api/requests' && req.method === 'GET') {
    const requestStore = new RequestStore(dataDir)
    const requests = requestStore.all()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(requests))
    return
  }

  // Remote delegation writes: child agents POST funding requests and treasury
  // agents PATCH statuses when FOURIER_DELEGATION_URL points at this server.
  if (pathname === '/api/requests' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}')
        const requesting = typeof payload.requesting_agent_id === 'string' ? payload.requesting_agent_id.trim() : ''
        const treasury = typeof payload.treasury_agent_id === 'string' ? payload.treasury_agent_id.trim() : ''
        const amount = Number(payload.amount_requested)
        const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
        if (!requesting || !treasury || !Number.isFinite(amount) || amount <= 0 || !reason) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'requesting_agent_id, treasury_agent_id, positive amount_requested and reason are required' }))
          return
        }
        const requestStore = new RequestStore(dataDir)
        const created = requestStore.createRequest(
          requesting,
          treasury,
          amount,
          reason,
          payload.user_id ?? null,
          payload.requesting_agent_address ?? null
        )
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(created))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
    })
    return
  }

  if (pathname.startsWith('/api/requests/') && req.method === 'PATCH') {
    const requestId = pathname.slice('/api/requests/'.length)
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}')
        const requestStore = new RequestStore(dataDir)

        if (payload.settled === true) {
          const settled = requestStore.markSettled(requestId)
          if (!settled) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'request not found' }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(settled))
          return
        }

        const status = payload.status
        if (status !== 'approved' && status !== 'rejected') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: "status must be 'approved' or 'rejected'" }))
          return
        }
        const updated = requestStore.updateStatus(requestId, status, {
          tx_hash: typeof payload.tx_hash === 'string' ? payload.tx_hash : undefined,
          rejection_reason: typeof payload.rejection_reason === 'string' ? payload.rejection_reason : undefined
        })
        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'request not found' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(updated))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
    })
    return
  }

  if (pathname === '/api/approvals' && req.method === 'GET') {
    const approvalStore = new ApprovalStore(dataDir)
    const approvals = approvalStore.all()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(approvals))
    return
  }

  if (pathname === '/api/simulate' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}')
        const config = loadConfig()
        const policy = loadPolicy(config)
        const provider = payload.provider || config.model.provider

        let result
        if (payload.replayDays) {
          result = await simulate({ replayDays: payload.replayDays }, policy, provider, config)
        } else if (payload.scenario && scenarios[payload.scenario]) {
          result = await simulate(scenarios[payload.scenario], policy, provider, config)
        } else {
          result = await simulate('live', policy, provider, config)
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
    })
    return
  }

  if (pathname === '/api/approve' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}')
        const approvalStore = new ApprovalStore(dataDir)
        const result = approvalStore.approve(payload.token)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
    })
    return
  }

  if (pathname === '/api/policy/compile' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}')
        const compiled = compilePolicy(payload.text || '')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(compiled))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
    })
    return
  }

  // --- Static Asset Serving ---

  let filePath = join(publicDir, pathname === '/' ? 'index.html' : pathname)
  if (!existsSync(filePath)) {
    filePath = join(publicDir, 'index.html')
  }

  try {
    const content = readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) })
    res.end(content)
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
})

const PORT = Number(process.env.PORT) || 3000
// When no auth token is configured the dashboard binds to localhost only;
// set FOURIER_DASHBOARD_TOKEN to expose it on all interfaces with auth.
const HOST = process.env.FOURIER_DASHBOARD_TOKEN?.trim() ? '0.0.0.0' : '127.0.0.1'
server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`)
  console.log(`  Fourier Operational Dashboard running at:`)
  console.log(`  http://${HOST === '0.0.0.0' ? '<all-interfaces>' : 'localhost'}:${PORT}`)
  console.log(`  Auth: ${process.env.FOURIER_DASHBOARD_TOKEN ? 'token required (FOURIER_DASHBOARD_TOKEN)' : 'local only (set FOURIER_DASHBOARD_TOKEN for remote access)'}`)
  console.log(`======================================================\n`)
})
