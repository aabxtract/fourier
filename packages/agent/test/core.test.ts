import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compilePolicy } from '../src/core/policy.js'
import { enforceGuardrails } from '../src/core/guardrails.js'
import { parseDecision } from '../src/core/decision-schema.js'
import { execute } from '../src/core/executor.js'
import { scenarios } from '../src/scenarios/index.js'

const policy = compilePolicy(
  'Warn me below 7 days. Below 3 days, top up at most 5 USDFC. Preserve customer-ledger before build-cache. Never triage without my approval.'
)

test('compiles a typed policy', () => {
  assert.equal(policy.warningRunwayDays, 7)
  assert.equal(policy.actionRunwayDays, 3)
  assert.equal(policy.maxAutoTopUpUSDFC, 5)
  assert.deepEqual(policy.datasetPriority, ['customer-ledger', 'build-cache'])
})

test('invalid model output becomes HOLD', () => {
  assert.equal(
    parseDecision('{"action":"TOP_UP","amountUSDFC":null}', scenarios['burn-spike'].state).action,
    'HOLD'
  )
})

test('top-up is clamped by code', () => {
  const result = enforceGuardrails(
    { action: 'TOP_UP', amountUSDFC: 99, reasoning: 'refill' },
    scenarios['burn-spike'].state,
    policy
  )
  assert.equal(result.status, 'allow')
  if (result.status === 'allow') {
    assert.equal(result.decision.action, 'TOP_UP')
    if (result.decision.action === 'TOP_UP') assert.equal(result.decision.amountUSDFC, 5)
  }
})

test('triage requires approval', () => {
  const triagePolicy = { ...policy, triageEnabled: true }
  const result = enforceGuardrails(
    { action: 'TRIAGE', rankedDatasetIds: ['build-cache'], reasoning: 'save priority data' },
    scenarios['budget-squeeze'].state,
    triagePolicy
  )
  assert.equal(result.status, 'approval_required')
})

test('simulation has no transaction id', async () => {
  const result = await execute(
    { action: 'TOP_UP', amountUSDFC: 2, reasoning: 'test' },
    { mode: 'simulate' }
  )
  assert.equal(result.status, 'simulated')
  assert.equal(result.transactionId, null)
})
