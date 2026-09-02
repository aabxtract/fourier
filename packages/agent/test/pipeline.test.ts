import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventStore } from '../src/core/store.js'
import { ApprovalStore, APPROVAL_TTL_MS } from '../src/core/approvals.js'
import { deriveBurnRate, projectRunwayDays, naiveRunwayDays } from '../src/core/history.js'
import { runOneCheck } from '../src/core/loop.js'
import { proposeFromScenario } from '../src/core/propose.js'
import { simulate } from '../src/core/simulate.js'
import { compilePolicy } from '../src/core/policy.js'
import { scenarios } from '../src/scenarios/index.js'
import type { Decision, ExecutionResult, FourierConfig } from '../src/types.js'

const dir = () => mkdtempSync(join(tmpdir(), 'fourier-test-'))

const config: FourierConfig = {
  agentId: 'fourier-test',
  network: 'calibration',
  role: 'standalone',
  treasuryAgentId: null,
  model: { provider: 'claude', model: 'claude-sonnet' },
  thresholds: { warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5 },
  actions: { topUpEnabled: true, triageEnabled: false, triageRequiresApproval: true },
  checkIntervalMinutes: 30
}

const triagePolicy = compilePolicy(
  'Warn me below 7 days. Below 3 days, top up at most 5 USDFC. Preserve customer-ledger and audit-archive before build-cache. Never triage without my approval.'
)

// ---------- history ----------

test('burn rate is null with fewer than two samples', () => {
  assert.equal(deriveBurnRate([]), null)
  assert.equal(deriveBurnRate([{ observedAt: '2026-08-26T09:00:00Z', availableUSDFC: 30 }]), null)
})

test('burn rate derived from most recent segment', () => {
  const history = scenarios['burn-spike'].history
  const rate = deriveBurnRate(history)
  assert.ok(rate !== null && rate > 0)
  // most recent segment: (13.88 - 12.4) over 6 hours = 5.92/day
  assert.ok(Math.abs(rate - 5.92) < 0.01)
})

test('history-aware projection matches scenario story', () => {
  const scenario = scenarios['burn-spike']
  const naive = naiveRunwayDays(scenario.state)
  const aware = projectRunwayDays(scenario.state, scenario.history)
  assert.equal(naive, 9.8)
  assert.ok(aware !== null)
  assert.ok(Math.abs(aware - 2.09) < 0.05)
  assert.ok(aware < naive)
})

// ---------- event store ----------

test('event store appends and reads durably', () => {
  const store = new EventStore(dir())
  const rec = store.append({
    agentId: 'a1',
    mode: 'simulate',
    scenario: 'burn-spike',
    state: scenarios['burn-spike'].state,
    proposal: { action: 'HOLD', reasoning: 'x' },
    proposalHash: 'abc',
    guardrail: { status: 'allow', clamped: false },
    decision: { action: 'HOLD', reasoning: 'x' },
    execution: { status: 'simulated', summary: 'none', transactionId: null }
  })
  assert.ok(rec.id.startsWith('evt_'))
  assert.equal(store.all().length, 1)
  assert.equal(store.unsynced().length, 1)
  store.markSynced([rec.id])
  assert.equal(store.unsynced().length, 0)
})

// ---------- approvals ----------

const triageDecision: Decision = { action: 'TRIAGE', rankedDatasetIds: ['build-cache'], reasoning: 'r' }

test('approval token is single-use', () => {
  const store = new ApprovalStore(dir())
  const approval = store.create(triageDecision)
  const first = store.approve(approval.token)
  assert.equal(first.ok, true)
  const second = store.approve(approval.token)
  assert.equal(second.ok, false)
  if (!second.ok) assert.equal(second.reason, 'already-used')
})

test('approval rejects unknown and expired tokens', () => {
  const store = new ApprovalStore(dir())
  const approval = store.create(triageDecision)
  assert.equal(store.approve('nope').ok, false)
  const expired = store.approve(approval.token, Date.now() + APPROVAL_TTL_MS + 1000)
  assert.equal(expired.ok, false)
  if (!expired.ok) assert.equal(expired.reason, 'expired')
})

// ---------- full pipeline ----------

test('runOneCheck burn-spike: proposal clamped and recorded', async () => {
  const store = new EventStore(dir())
  const approvals = new ApprovalStore(dir())
  const scenario = scenarios['burn-spike']

  const result = await runOneCheck(config, triagePolicy, {
    store,
    approvals,
    mode: 'simulate',
    scenario,
    propose: async (s, _p, prov) => proposeFromScenario(s, scenario.history, prov)
  })

  assert.equal(result.event.decision.action, 'TOP_UP')
  if (result.event.decision.action === 'TOP_UP') {
    assert.equal(result.event.decision.amountUSDFC, 5) // clamped from 7.5
  }
  assert.equal(result.event.guardrail.status, 'allow')
  assert.equal(result.event.execution.transactionId, null)
  assert.ok(result.event.proposalHash.length === 64)
  assert.equal(store.all().length, 1)
})

test('runOneCheck budget-squeeze: TRIAGE gated to approval, no execution', async () => {
  const store = new EventStore(dir())
  const approvals = new ApprovalStore(dir())
  const scenario = scenarios['budget-squeeze']

  const result = await runOneCheck(config, triagePolicy, {
    store,
    approvals,
    mode: 'simulate',
    scenario,
    propose: async (s, _p, prov) => proposeFromScenario(s, scenario.history, prov)
  })

  assert.equal(result.event.guardrail.status, 'approval_required')
  assert.equal(result.event.execution.status, 'awaiting_approval')
  assert.equal(result.event.execution.transactionId, null)
  assert.ok(result.approval !== null)

  // approve it via the token
  const approved = approvals.approve(result.approval!.token)
  assert.equal(approved.ok, true)
})

test('runOneCheck defaults: TRIAGE disabled becomes HOLD', async () => {
  const store = new EventStore(dir())
  const approvals = new ApprovalStore(dir())
  const scenario = scenarios['budget-squeeze']

  const result = await runOneCheck(config, { ...triagePolicy, triageEnabled: false }, {
    store,
    approvals,
    mode: 'simulate',
    scenario,
    propose: async (s, _p, prov) => proposeFromScenario(s, scenario.history, prov)
  })

  assert.equal(result.event.decision.action, 'HOLD')
  assert.equal(result.event.guardrail.status, 'hold')
  assert.equal(result.approval, null)
})

test('simulate burn-spike matches expected scenario', async () => {
  const out = await simulate(scenarios['burn-spike'], triagePolicy, 'claude', config)
  assert.equal(out.scenario, 'burn-spike')
  assert.equal((out.decision as Decision).action, 'TOP_UP')
  assert.equal((out.execution as ExecutionResult).transactionId, null)
})
