import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseConfig } from '../src/core/config.js'
import { MemoryStore, evaluatePreviousOutcome, formatMemoryContext } from '../src/core/memory.js'
import { RequestStore, executeFilecoinPayTransfer } from '../src/core/delegation.js'
import { Brain } from '../src/core/brain.js'
import { classifyError } from '../src/core/logger.js'
import { NotificationManager } from '../src/notifications/index.js'
import { compilePolicy } from '../src/core/policy.js'
import { scenarios } from '../src/scenarios/index.js'
import type { FourierConfig, WatcherState } from '../src/types.js'

const dir = () => mkdtempSync(join(tmpdir(), 'fourier-v2-test-'))

const testPolicy = compilePolicy(
  'Warn me below 7 days. Below 3 days, top up at most 5 USDFC. Preserve customer-ledger before build-cache. Never triage without my approval.'
)

// ---------- Config Validation ----------

test('config validation accepts valid standalone config', () => {
  const valid = {
    agentId: 'agent-1',
    network: 'calibration',
    role: 'standalone',
    treasuryAgentId: null,
    model: { provider: 'claude', model: 'claude-3-7-sonnet-latest' },
    thresholds: { warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5 },
    actions: { topUpEnabled: true, triageEnabled: false, triageRequiresApproval: true },
    checkIntervalMinutes: 30
  }
  const parsed = parseConfig(valid)
  assert.equal(parsed.agentId, 'agent-1')
  assert.equal(parsed.role, 'standalone')
})

test('config validation rejects child role without treasuryAgentId', () => {
  const invalid = {
    agentId: 'child-1',
    network: 'calibration',
    role: 'child',
    treasuryAgentId: null, // missing!
    model: { provider: 'claude', model: 'claude-3-7-sonnet-latest' },
    thresholds: { warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5 },
    actions: { topUpEnabled: true, triageEnabled: false, triageRequiresApproval: true },
    checkIntervalMinutes: 30
  }
  assert.throws(() => parseConfig(invalid), /treasuryAgentId is required/)
})

test('config validation rejects warningRunwayDays <= actionRunwayDays', () => {
  const invalid = {
    agentId: 'agent-1',
    network: 'calibration',
    role: 'standalone',
    treasuryAgentId: null,
    model: { provider: 'claude', model: 'claude-3-7-sonnet-latest' },
    thresholds: { warningRunwayDays: 3, actionRunwayDays: 5, maxAutoTopUpUSDFC: 5 }, // 3 < 5!
    actions: { topUpEnabled: true, triageEnabled: false, triageRequiresApproval: true },
    checkIntervalMinutes: 30
  }
  assert.throws(() => parseConfig(invalid), /actionRunwayDays must be strictly less than warningRunwayDays/)
})

// ---------- Agent Memory & Learning ----------

test('agent memory records decisions and evaluates outcomes across cycles', () => {
  const memStore = new MemoryStore(dir())
  const agentId = 'test-agent'

  // Cycle 1: record TOP_UP at 2.5d runway
  const mem1 = memStore.recordDecision(agentId, { action: 'TOP_UP', amountUSDFC: 5, reasoning: 'low' }, 2.5)
  assert.equal(mem1.outcome, null)

  // Cycle 2: state observed with runway now 15d -> evaluated as SUCCESS
  const stateCycle2: WatcherState = {
    observedAt: new Date().toISOString(),
    runwayDays: 15.0,
    availableUSDFC: 15.0,
    lockedUSDFC: 2.0,
    spendRateUSDFCPerDay: 1.0,
    datasets: [],
    source: 'live'
  }

  const outcome = evaluatePreviousOutcome(mem1, stateCycle2, 3.0)
  assert.ok(outcome.startsWith('SUCCESS'))
  memStore.updateOutcome(mem1.id, outcome)

  const updated = memStore.all(agentId)[0]
  assert.equal(updated.outcome, outcome)

  // Context formatting
  const formatted = formatMemoryContext(memStore.getRecent(agentId, 10))
  assert.ok(formatted.includes('Action: TOP_UP (5 USDFC)'))
  assert.ok(formatted.includes('SUCCESS'))
})

test('agent memory evaluates HOLD that leads to critical depletion as FAILED', () => {
  const memStore = new MemoryStore(dir())
  const memHold = memStore.recordDecision('test-agent', { action: 'HOLD', reasoning: 'waiting' }, 3.5)

  const stateDepleted: WatcherState = {
    observedAt: new Date().toISOString(),
    runwayDays: 0.8, // dropped into emergency
    availableUSDFC: 0.8,
    lockedUSDFC: 2.0,
    spendRateUSDFCPerDay: 5.0,
    datasets: [],
    source: 'live'
  }

  const outcome = evaluatePreviousOutcome(memHold, stateDepleted, 3.0)
  assert.ok(outcome.startsWith('FAILED'))
})

// ---------- Multi-Agent Delegation ----------

test('delegation request store handles child requests and treasury approvals', async () => {
  const reqStore = new RequestStore(dir())

  // Child creates funding request
  const req = await reqStore.createRequest('child-01', 'treasury-main', 5.0, 'Runway low (2.1 days)')
  assert.equal(req.status, 'pending')
  assert.equal(req.amount_requested, 5.0)

  // Treasury queries pending
  const pending = await reqStore.getPendingForTreasury('treasury-main')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].id, req.id)

  // Execute Filecoin Pay simulated transfer
  const treasuryState: WatcherState = {
    observedAt: new Date().toISOString(),
    runwayDays: 30,
    availableUSDFC: 100,
    lockedUSDFC: 10,
    spendRateUSDFCPerDay: 1.0,
    datasets: [],
    source: 'live'
  }
  const transfer = await executeFilecoinPayTransfer(treasuryState, req, 5.0, 'simulate')
  assert.equal(transfer.status, 'simulated')
  assert.ok(transfer.txHash !== null && transfer.txHash.startsWith('0x_sim_pay_'))

  // Update status to approved
  const approvedReq = await reqStore.updateStatus(req.id, 'approved', { tx_hash: transfer.txHash ?? undefined })
  assert.equal(approvedReq?.status, 'approved')
  assert.equal(approvedReq?.tx_hash, transfer.txHash)
  assert.equal((await reqStore.getPendingForTreasury('treasury-main')).length, 0)
})

// ---------- Error Classification & Notifications ----------

test('error classifier correctly classifies errors by stage', () => {
  assert.equal(classifyError(new Error('WatcherError: failed onchain RPC read')).stage, 'watcher')
  assert.equal(classifyError(new Error('Model inference timeout')).stage, 'model')
  assert.equal(classifyError(new Error('Telegram API responded with 401')).stage, 'notification')
})

test('notification manager broadcasts safely without throwing on empty credentials', async () => {
  const mgr = new NotificationManager()
  const results = await mgr.broadcast({
    level: 'info',
    title: 'Test',
    message: 'Test message',
    agentId: 'test-agent',
    timestamp: new Date().toISOString()
  })
  assert.ok(Array.isArray(results))
})
