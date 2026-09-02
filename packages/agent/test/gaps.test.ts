import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { Watcher } from '../src/core/watcher.js'
import { execute } from '../src/core/executor.js'
import { RequestStore, RemoteRequestStore, executeFilecoinPayTransfer } from '../src/core/delegation.js'
import { ApprovalStore } from '../src/core/approvals.js'
import { ConversationEngine } from '../src/core/conversation.js'
import { syncEventOutbox } from '../src/core/sync.js'
import { EventStore } from '../src/core/store.js'
import { createFourierClient, resetSharedClient } from '../src/core/synapse.js'
import { parseConfig } from '../src/core/config.js'
import type { FourierConfig, Decision } from '../src/types.js'

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'fourier-gaps-'))
}

function makeConfig(overrides: Partial<FourierConfig> = {}): FourierConfig {
  return {
    agentId: 'gaps-test',
    network: 'calibration',
    role: 'standalone',
    treasuryAgentId: null,
    model: { provider: 'claude', model: 'claude-3-7-sonnet-latest' },
    thresholds: { warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5 },
    actions: { topUpEnabled: true, triageEnabled: true, triageRequiresApproval: true },
    checkIntervalMinutes: 30,
    ...overrides
  }
}

test('watcher without wallet configuration reports demo-fixture, not live', async () => {
  const watcher = new Watcher({ network: 'calibration' })
  const state = await watcher.readState()
  assert.equal(state.source, 'demo-fixture')
})

test('watcher maps a real Synapse account summary into WatcherState', async () => {
  const fake = {
    synapse: {
      payments: {
        accountSummary: async () => ({
          availableFunds: 10_000_000_000_000_000_000n, // 10 USDFC
          totalLockup: 2_000_000_000_000_000_000n, // 2 USDFC
          lockupRatePerEpoch: 1n,
          runwayInEpochs: 500n
        })
      },
      storage: {
        findDataSets: async () => [
          { dataSetId: 42n, isLive: true },
          { dataSetId: 43n, isLive: false }
        ]
      }
    } as never,
    walletAddress: '0x3b890f912D23c9E32d3F793f63c874b9c1d0bE32',
    canSign: false
  }
  const watcher = new Watcher({ client: fake })
  const state = await watcher.readState()
  assert.equal(state.source, 'live')
  assert.equal(state.availableUSDFC, 10)
  assert.equal(state.lockedUSDFC, 2)
  assert.equal(state.runwayDays, 0.17)
  assert.equal(state.datasets.length, 2)
  assert.equal(state.datasets[0].id, '42')
  assert.equal(state.datasets[1].status, 'terminated')
})

test('createFourierClient returns null without credentials and read-only with an address', () => {
  assert.equal(createFourierClient({ network: 'calibration' }), null)

  const readOnly = createFourierClient({
    network: 'calibration',
    walletAddress: '0x3b890f912D23c9E32d3F793f63c874b9c1d0bE32'
  })
  assert.ok(readOnly)
  assert.equal(readOnly!.canSign, false)
  assert.equal(readOnly!.walletAddress.toLowerCase(), '0x3b890f912d23c9e32d3f793f63c874b9c1d0be32')
})

test('live TOP_UP without a signer fails honestly instead of faking a tx hash', async () => {
  const decision: Decision = { action: 'TOP_UP', amountUSDFC: 2, reasoning: 'test' }
  const result = await execute(decision, { mode: 'live' }, undefined, { synapseClient: null })
  assert.equal(result.status, 'failed')
  assert.equal(result.transactionId, null)
})

test('live filecoin pay transfer without address fails honestly', async () => {
  const store = new RequestStore(dir())
  const request = await store.createRequest('child-1', 'treasury-1', 3, 'test runway')
  const result = await executeFilecoinPayTransfer(
    { observedAt: '', runwayDays: 5, availableUSDFC: 10, lockedUSDFC: 0, spendRateUSDFCPerDay: 1, datasets: [], source: 'demo-fixture' },
    request,
    3,
    'live',
    null
  )
  assert.equal(result.status, 'failed')
  assert.equal(result.txHash, null)
})

test('remote request store talks the dashboard coordination protocol', async () => {
  const backendDir = dir()
  const backend = new RequestStore(backendDir)
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (url.pathname === '/api/requests' && req.method === 'GET') {
      backend.all().then(r => send(200, r)).catch(() => send(500, { error: 'read failed' }))
      return
    }
    if (url.pathname === '/api/requests' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body)
          const created = await backend.createRequest(
            p.requesting_agent_id,
            p.treasury_agent_id,
            p.amount_requested,
            p.reason,
            p.user_id ?? null,
            p.requesting_agent_address ?? null
          )
          send(201, created)
        } catch (err) {
          send(400, { error: err instanceof Error ? err.message : String(err) })
        }
      })
      return
    }
    if (url.pathname.startsWith('/api/requests/') && req.method === 'PATCH') {
      const id = url.pathname.slice('/api/requests/'.length)
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body)
          if (p.settled === true) {
            send(200, await backend.markSettled(id))
            return
          }
          send(200, await backend.updateStatus(id, p.status, { tx_hash: p.tx_hash, rejection_reason: p.rejection_reason }))
        } catch (err) {
          send(400, { error: err instanceof Error ? err.message : String(err) })
        }
      })
      return
    }
    send(404, { error: 'not found' })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const remote = new RemoteRequestStore(`http://127.0.0.1:${port}`)

  try {
    const created = await remote.createRequest('child-remote', 'treasury-remote', 4, 'remote runway', null, '0xchild')
    assert.equal(created.status, 'pending')
    assert.equal(created.requesting_agent_address, '0xchild')

    const pending = await remote.getPendingForTreasury('treasury-remote')
    assert.equal(pending.length, 1)

    const approved = await remote.updateStatus(created.id, 'approved', { tx_hash: '0xtest' })
    assert.equal(approved!.status, 'approved')
    assert.equal(approved!.tx_hash, '0xtest')

    const settled = await remote.markSettled(created.id)
    assert.ok(settled!.settled_at)

    const mine = await remote.getForRequester('child-remote')
    assert.equal(mine.length, 1)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(backendDir, { recursive: true, force: true })
  }
})

test('conversation engine redeems /approve tokens without model inference', async () => {
  const approvalsDir = dir()
  const approvals = new ApprovalStore(approvalsDir)
  const proposal: Decision = { action: 'TRIAGE', rankedDatasetIds: ['build-cache'], reasoning: 'ranked' }
  const approval = approvals.create(proposal)

  const engine = new ConversationEngine(makeConfig(), { version: 1, warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5, datasetPriority: [], topUpEnabled: true, triageEnabled: true, triageRequiresApproval: true }, approvals)

  const ok = await engine.handleMessage(`/approve ${approval.token}`, 'telegram')
  assert.ok(ok.response.includes('Approved'))

  const reuse = await engine.handleMessage(`/approve ${approval.token}`, 'telegram')
  assert.ok(reuse.response.includes('already used'))

  const unknown = await engine.handleMessage('/approve deadbeef', 'telegram')
  assert.ok(unknown.response.includes('not found'))

  rmSync(approvalsDir, { recursive: true, force: true })
})

test('event outbox sync is a no-op without remote config', async () => {
  const d = dir()
  const store = new EventStore(d)
  store.append({
    agentId: 'a',
    mode: 'simulate',
    scenario: null,
    state: { observedAt: '', runwayDays: 5, availableUSDFC: 1, lockedUSDFC: 0, spendRateUSDFCPerDay: null, datasets: [], source: 'demo-fixture' },
    proposal: { action: 'HOLD', reasoning: 'x' },
    proposalHash: 'h',
    guardrail: { status: 'allow' },
    decision: { action: 'HOLD', reasoning: 'x' },
    execution: { status: 'skipped', summary: '', transactionId: null },
    policyVersion: 1
  })

  const result = await syncEventOutbox(store, { databaseUrl: '' })
  assert.equal(result.skipped, true)
  assert.equal(store.unsynced().length, 1)
  rmSync(d, { recursive: true, force: true })
})

test('cloud sync fails safely and preserves the outbox when the database is unreachable', async () => {
  const d = dir()
  const store = new EventStore(d)
  store.append({
    agentId: 'a',
    mode: 'simulate',
    scenario: null,
    state: { observedAt: '', runwayDays: 5, availableUSDFC: 1, lockedUSDFC: 0, spendRateUSDFCPerDay: null, datasets: [], source: 'demo-fixture' },
    proposal: { action: 'HOLD', reasoning: 'x' },
    proposalHash: 'h',
    guardrail: { status: 'allow' },
    decision: { action: 'HOLD', reasoning: 'x' },
    execution: { status: 'skipped', summary: '', transactionId: null },
    policyVersion: 1
  })

  // Nothing listens on port 1 — connection must fail fast, never throw.
  const result = await syncEventOutbox(store, { databaseUrl: 'postgresql://test:test@127.0.0.1:1/db' })
  assert.equal(result.skipped, false)
  assert.equal(result.synced, 0)
  assert.ok(result.error)
  // Outbox intact — events retry on a later cycle.
  assert.equal(store.unsynced().length, 1)
  rmSync(d, { recursive: true, force: true })
})

test('access code store generates, keeps, and rotates codes', async () => {
  const d = dir()
  const { AccessCodeStore, hashCode, normalizeCode, generateRawCode } = await import('../src/core/access-code.js')
  const store = new AccessCodeStore(d)

  const created = store.create('agent-1')
  assert.match(created.rawCode, /^FK-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/)
  assert.equal(created.codeHash, hashCode(created.rawCode))
  // create is idempotent
  assert.equal(store.create('agent-1').rawCode, created.rawCode)

  const rotated = store.rotate('agent-1')
  assert.notEqual(rotated.rawCode, created.rawCode)
  assert.ok(rotated.previousHashes.includes(created.codeHash))

  // normalizer repairs common mistypes: O->0, I/L->1, strips separators
  assert.equal(normalizeCode('fk-o1l2o-ab3cd-ef4gh'), 'FK-01120-AB3CD-EF4GH')
  assert.equal(normalizeCode('FK 01120 AB3CD EF4GH'), 'FK-01120-AB3CD-EF4GH')
  assert.equal(normalizeCode(created.rawCode), created.rawCode)

  const raw = generateRawCode()
  assert.equal(raw.length, 'FK-XXXXX-XXXXX-XXXXX'.length)
  rmSync(d, { recursive: true, force: true })
})

test('config accepts delegationPollMinutes and child role requirements stay enforced', () => {
  const parsed = parseConfig(makeConfig({ role: 'treasury', delegationPollMinutes: 5 }))
  assert.equal(parsed.delegationPollMinutes, 5)
  assert.throws(() => parseConfig(makeConfig({ role: 'child', treasuryAgentId: null })))
})

test('request store persists requesting_agent_address for treasury transfers', async () => {
  const d = dir()
  const store = new RequestStore(d)
  const created = await store.createRequest('child-1', 'treasury-1', 5, 'low runway', null, '0xchildwallet')
  const pending = await store.getPendingForTreasury('treasury-1')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].requesting_agent_address, '0xchildwallet')
  assert.equal((await store.getRequestById(created.id))?.requesting_agent_address, '0xchildwallet')
})

test('resetSharedClient clears the cached synapse client', async () => {
  resetSharedClient()
})
