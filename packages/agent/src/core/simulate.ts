import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CompiledPolicy, FourierConfig, Provider, Scenario, WatcherState } from '../types.js'
import { runOneCheck } from './loop.js'
import { EventStore, type EventRecord } from './store.js'
import { ApprovalStore } from './approvals.js'
import { MemoryStore } from './memory.js'
import { RequestStore } from './delegation.js'
import { Watcher } from './watcher.js'
import { scenarios } from '../scenarios/index.js'

export interface SimulationResult {
  mode: 'scenario' | 'live' | 'replay'
  scenario?: string
  replayDays?: number
  state: WatcherState
  proposal: unknown
  guardrail: unknown
  decision: unknown
  execution: unknown
  approval: { token: string; expiresAt: string } | null
  projections?: unknown
  replayedEvents?: EventRecord[]
}

/**
 * Run simulation for named scenarios, live onchain state, or historical replay.
 */
export async function simulate(
  target: Scenario | 'live' | { replayDays: number },
  policy: CompiledPolicy,
  provider: Provider,
  config?: FourierConfig,
  customDir?: string
): Promise<SimulationResult> {
  const dir = customDir ?? mkdtempSync(join(tmpdir(), 'fourier-sim-'))
  if (customDir) mkdirSync(dir, { recursive: true })
  const store = new EventStore(dir, 'events.jsonl')
  const approvals = new ApprovalStore(dir)
  const memory = new MemoryStore(dir)
  const requests = new RequestStore(dir)

  const cfg: FourierConfig =
    config ?? {
      agentId: 'fourier-sim',
      network: 'calibration',
      role: 'standalone',
      treasuryAgentId: null,
      model: { provider, model: provider },
      thresholds: {
        warningRunwayDays: policy.warningRunwayDays,
        actionRunwayDays: policy.actionRunwayDays,
        maxAutoTopUpUSDFC: policy.maxAutoTopUpUSDFC
      },
      actions: {
        topUpEnabled: policy.topUpEnabled,
        triageEnabled: policy.triageEnabled,
        triageRequiresApproval: policy.triageRequiresApproval
      },
      checkIntervalMinutes: 30
    }

  // Case 1: Historical Replay
  if (typeof target === 'object' && 'replayDays' in target) {
    const historicalStore = new EventStore('.fourier')
    const all = historicalStore.all()
    const cutoff = Date.now() - target.replayDays * 86400000
    const filtered = all.filter(e => new Date(e.recordedAt).getTime() >= cutoff)

    return {
      mode: 'replay',
      replayDays: target.replayDays,
      state: filtered[filtered.length - 1]?.state || {
        observedAt: new Date().toISOString(),
        runwayDays: 5,
        availableUSDFC: 10,
        lockedUSDFC: 2,
        spendRateUSDFCPerDay: 2,
        datasets: [],
        source: 'scenario'
      },
      proposal: filtered[filtered.length - 1]?.proposal || null,
      guardrail: filtered[filtered.length - 1]?.guardrail || null,
      decision: filtered[filtered.length - 1]?.decision || null,
      execution: {
        status: 'simulated',
        summary: `Replayed ${filtered.length} historical events over last ${target.replayDays} days.`,
        transactionId: null
      },
      approval: null,
      replayedEvents: filtered
    }
  }

  // Case 2: Live Onchain State Simulation (Zero-tx execution)
  if (target === 'live') {
    const watcher = new Watcher({ network: cfg.network, walletAddress: cfg.walletAddress })
    const state = await watcher.readState()

    const result = await runOneCheck(cfg, policy, {
      store,
      approvals,
      memory,
      requests,
      mode: 'simulate',
      readState: async () => state
    })

    return {
      mode: 'live',
      state: result.event.state,
      proposal: result.event.proposal,
      guardrail: result.event.guardrail,
      decision: result.event.decision,
      execution: result.execution,
      approval: result.approval ? { token: result.approval.token, expiresAt: result.approval.expiresAt } : null,
      projections: (result.event.state as unknown as { projections: unknown })?.projections
    }
  }

  // Case 3: Named Scenario Simulation
  const scenario = target
  const result = await runOneCheck(cfg, policy, {
    store,
    approvals,
    memory,
    requests,
    mode: 'simulate',
    scenario
  })

  return {
    mode: 'scenario',
    scenario: scenario.name,
    state: result.event.state,
    proposal: result.event.proposal,
    guardrail: result.event.guardrail,
    decision: result.event.decision,
    execution: result.execution,
    approval: result.approval ? { token: result.approval.token, expiresAt: result.approval.expiresAt } : null,
    projections: (result.event.state as unknown as { projections: unknown })?.projections
  }
}
