import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runLoop, runOneCheck } from '../core/loop.js'
import { parseConfig } from '../core/config.js'
import { EventStore } from '../core/store.js'
import { ApprovalStore } from '../core/approvals.js'
import { MemoryStore } from '../core/memory.js'
import { RequestStore } from '../core/delegation.js'
import { scenarios } from '../scenarios/index.js'
import type { CompiledPolicy, FourierConfig } from '../types.js'

export async function startCommand(args: string[]) {
  const root = process.cwd()
  const configPath = resolve(root, 'fourier.config.json')
  const policyPath = resolve(root, 'fourier.policy.json')

  let config: FourierConfig
  if (existsSync(configPath)) {
    config = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')))
  } else {
    config = {
      agentId: 'fourier-local',
      network: 'calibration',
      role: 'standalone',
      treasuryAgentId: null,
      model: { provider: 'claude', model: 'claude-3-7-sonnet-latest' },
      thresholds: { warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5 },
      actions: { topUpEnabled: true, triageEnabled: false, triageRequiresApproval: true },
      checkIntervalMinutes: 30
    }
  }

  let policy: CompiledPolicy
  if (existsSync(policyPath)) {
    policy = JSON.parse(readFileSync(policyPath, 'utf8')) as CompiledPolicy
  } else {
    policy = {
      version: 1,
      ...config.thresholds,
      ...config.actions,
      datasetPriority: ['customer-ledger', 'audit-archive', 'build-cache']
    }
  }

  // Check if --simulate flag passed
  const simIndex = args.indexOf('--simulate')
  if (simIndex !== -1) {
    const scenarioName = args[simIndex + 1]
    const scenario = scenarioName ? scenarios[scenarioName] : undefined
    const store = new EventStore('.fourier')
    const approvals = new ApprovalStore('.fourier')
    const memory = new MemoryStore('.fourier')
    const requests = new RequestStore('.fourier')

    console.log(`Starting simulated single-check run${scenario ? ` (${scenarioName})` : ''}...`)
    const result = await runOneCheck(config, policy, {
      store,
      approvals,
      memory,
      requests,
      mode: 'simulate',
      scenario
    })
    console.log(JSON.stringify(result.event, null, 2))
    return
  }

  // Run autonomous loop
  await runLoop(config, policy)
}
