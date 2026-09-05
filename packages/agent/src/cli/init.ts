import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupCommand } from './setup.js'

export async function initCommand(options: { role?: 'standalone' | 'child' | 'treasury'; treasuryId?: string } = {}) {
  const root = process.cwd()
  const configPath = resolve(root, 'fourier.config.json')
  const policyPath = resolve(root, 'policy.txt')

  const role = options.role || 'standalone'
  const config = {
    agentId: `fourier-${role}-${Date.now().toString(36)}`,
    network: 'calibration',
    role,
    treasuryAgentId: role === 'child' ? options.treasuryId || 'treasury-main' : null,
    walletAddress: '0x0000000000000000000000000000000000000000',
    model: {
      provider: 'claude',
      model: 'claude-3-7-sonnet-latest'
    },
    thresholds: {
      warningRunwayDays: 7,
      actionRunwayDays: 3,
      maxAutoTopUpUSDFC: 5
    },
    actions: {
      topUpEnabled: true,
      triageEnabled: false,
      triageRequiresApproval: true
    },
    checkIntervalMinutes: 30
  }

  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
    console.log(`Created configuration at: ${configPath}`)
  } else {
    console.log(`Configuration already exists at: ${configPath}`)
  }

  const samplePolicy = [
    'Warn me below 7 days of runway. Below 3 days, top up at most 5 USDFC.',
    'Preserve customer-ledger and audit-archive before build-cache.',
    'Never terminate a dataset without my approval.'
  ].join('\n')

  if (!existsSync(policyPath)) {
    writeFileSync(policyPath, samplePolicy + '\n')
    console.log(`Created sample policy at: ${policyPath}`)
  }

  console.log('\nFourier initialization complete!')

  // Interactive terminals get the key-setup flow: the agent asks for the
  // private key and writes .env directly — no manual file editing.
  if (process.stdin.isTTY && process.stdout.isTTY) {
    await setupCommand()
    return
  }

  console.log('Next steps:')
  console.log('  1. Configure secrets:  npx fourier setup')
  console.log('  2. Compile policy:     npx fourier policy compile policy.txt')
  console.log('  3. Run simulation:     npx fourier simulate burn-spike')
  console.log('  4. Start agent loop:   npx fourier start')
}
