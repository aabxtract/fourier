import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { simulate } from '../core/simulate.js'
import { parseConfig } from '../core/config.js'
import { scenarios } from '../scenarios/index.js'
import type { CompiledPolicy, FourierConfig } from '../types.js'

export async function simulateCommand(args: string[]) {
  const root = process.cwd()
  const configPath = resolve(root, 'fourier.config.json')
  const policyPath = resolve(root, 'fourier.policy.json')

  let config: FourierConfig | undefined
  if (existsSync(configPath)) {
    try {
      config = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')))
    } catch {
      // fallback
    }
  }

  let policy: CompiledPolicy
  if (existsSync(policyPath)) {
    policy = JSON.parse(readFileSync(policyPath, 'utf8')) as CompiledPolicy
  } else {
    policy = {
      version: 1,
      warningRunwayDays: config?.thresholds.warningRunwayDays ?? 7,
      actionRunwayDays: config?.thresholds.actionRunwayDays ?? 3,
      maxAutoTopUpUSDFC: config?.thresholds.maxAutoTopUpUSDFC ?? 5,
      datasetPriority: ['customer-ledger', 'audit-archive', 'build-cache'],
      topUpEnabled: true,
      triageEnabled: true,
      triageRequiresApproval: true
    }
  }

  const provider = config?.model.provider ?? 'claude'

  console.log('====================================================')
  console.log('  [SIMULATION MODE — no transactions will be sent]  ')
  console.log('====================================================\n')

  const dataDir = resolve(root, '.fourier')

  // Flag check: --days <N>
  const daysIndex = args.indexOf('--days')
  if (daysIndex !== -1 && args[daysIndex + 1]) {
    const days = parseInt(args[daysIndex + 1], 10)
    console.log(`Replaying historical events from the last ${days} days...`)
    const res = await simulate({ replayDays: days }, policy, provider, config, dataDir)
    console.log(JSON.stringify(res, null, 2))
    return
  }

  const targetName = args[0]
  if (targetName && scenarios[targetName]) {
    console.log(`Running scenario: ${targetName}`)
    const res = await simulate(scenarios[targetName], policy, provider, config, dataDir)
    console.log(JSON.stringify(res, null, 2))
    return
  }

  // Live onchain simulation
  console.log('Running live onchain state inspection (Simulation)...')
  const res = await simulate('live', policy, provider, config, dataDir)
  console.log(JSON.stringify(res, null, 2))
}
