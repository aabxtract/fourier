import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runOneCheck } from '../core/loop.js'
import { parseConfig } from '../core/config.js'
import { EventStore } from '../core/store.js'
import { ApprovalStore } from '../core/approvals.js'
import { MemoryStore } from '../core/memory.js'
import { RequestStore } from '../core/delegation.js'
import { NotificationManager } from '../notifications/index.js'
import type { CompiledPolicy, FourierConfig, WatcherState } from '../types.js'

// ANSI colour codes for styled terminal output
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bgBlack: '\x1b[40m'
}

function banner(icon: string, label: string, color: string): void {
  console.log()
  console.log(`${color}${C.bold}  ╔═══════════════════════════════════════════════╗${C.reset}`)
  console.log(`${color}${C.bold}  ║  ${icon}  ${label.padEnd(40)}║${C.reset}`)
  console.log(`${color}${C.bold}  ╚═══════════════════════════════════════════════╝${C.reset}`)
}

function logStep(icon: string, color: string, label: string, detail: string): void {
  console.log(`  ${color}${icon}${C.reset}  ${C.bold}${label}${C.reset}  ${C.dim}${detail}${C.reset}`)
}

export async function demoCommand() {
  const root = process.cwd()
  const configPath = resolve(root, 'fourier.config.json')
  const policyPath = resolve(root, 'fourier.policy.json')

  banner('🎬', 'FOURIER DEMO MODE', C.magenta)
  console.log(`  ${C.dim}Interval: 1 minute  |  Artificial state  |  5 cycles max${C.reset}`)
  console.log(`  ${C.dim}This mode is designed for clean video recording.${C.reset}`)
  console.log()

  // Load config
  let config: FourierConfig
  if (existsSync(configPath)) {
    config = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')))
  } else {
    config = {
      agentId: 'fourier-demo',
      network: 'calibration',
      role: 'standalone',
      treasuryAgentId: null,
      model: { provider: 'groq', model: 'openai/gpt-oss-120b' },
      thresholds: { warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5 },
      actions: { topUpEnabled: true, triageEnabled: false, triageRequiresApproval: true },
      checkIntervalMinutes: 1
    }
  }

  // Force demo settings
  config.checkIntervalMinutes = 1

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

  const store = new EventStore('.fourier')
  const approvals = new ApprovalStore('.fourier')
  const memory = new MemoryStore('.fourier')
  const requests = new RequestStore('.fourier')
  const notifications = new NotificationManager()

  // Demo state — artificially low runway to trigger action
  const demoState: WatcherState = {
    observedAt: new Date().toISOString(),
    runwayDays: 2.8,
    availableUSDFC: 3.2,
    lockedUSDFC: 6.5,
    spendRateUSDFCPerDay: 4.1,
    datasets: [
      { id: 'customer-ledger', status: 'active', pieceCount: 1200 },
      { id: 'audit-archive', status: 'active', pieceCount: 800 },
      { id: 'build-cache', status: 'active', pieceCount: 500 }
    ],
    source: 'scenario',
    walletAddress: config.walletAddress || '0xdemo'
  }

  const maxCycles = 5
  const demoStartTime = Date.now()
  const demoMaxDurationMs = 5 * 60 * 1000 // 5 minutes

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    if (Date.now() - demoStartTime > demoMaxDurationMs) {
      banner('⏱️', 'DEMO TIMEOUT (5 min)', C.yellow)
      break
    }

    banner('🔄', `CYCLE ${cycle}/${maxCycles}`, C.cyan)

    // Step 1: Show state
    logStep('🔍', C.cyan, 'STATE', 'Reading onchain state (demo)...')
    console.log(`     ${C.cyan}Runway:${C.reset}    ${demoState.runwayDays.toFixed(1)} days ${demoState.runwayDays <= 3 ? C.red + '⚠ CRITICAL' + C.reset : ''}`)
    console.log(`     ${C.cyan}Available:${C.reset} ${demoState.availableUSDFC.toFixed(2)} USDFC`)
    console.log(`     ${C.cyan}Locked:${C.reset}    ${demoState.lockedUSDFC.toFixed(2)} USDFC`)
    console.log(`     ${C.cyan}Burn Rate:${C.reset} ${demoState.spendRateUSDFCPerDay!.toFixed(2)} USDFC/day`)
    console.log(`     ${C.cyan}Datasets:${C.reset}  ${demoState.datasets.map(d => d.id).join(', ')}`)
    console.log()

    // Step 2: Run decision loop
    logStep('🧠', C.yellow, 'REASONING', 'Sending state to AI model...')

    try {
      const result = await runOneCheck(config, policy, {
        store,
        approvals,
        memory,
        requests,
        notifications,
        mode: 'simulate',
        readState: async () => ({ ...demoState, observedAt: new Date().toISOString() })
      })

      // Step 3: Show decision
      const decision = result.event.decision
      const actionColor = decision.action === 'TOP_UP' ? C.green
        : decision.action === 'WARN' ? C.yellow
        : decision.action === 'TRIAGE' ? C.red
        : C.white

      logStep('✅', C.green, 'DECISION', `${actionColor}${decision.action}${C.reset}`)
      console.log(`     ${C.dim}Reasoning: ${decision.reasoning}${C.reset}`)

      if (decision.action === 'TOP_UP') {
        console.log(`     ${C.green}Amount: ${decision.amountUSDFC.toFixed(2)} USDFC${C.reset}`)
      }

      // Step 4: Show guardrail status
      const guardrail = result.event.guardrail
      logStep('🛡️', C.blue, 'GUARDRAIL', `Status: ${guardrail.status}${guardrail.clamped ? ' (amount clamped to policy max)' : ''}`)

      // Step 5: Show execution
      logStep('⚡', C.magenta, 'EXECUTION', `${result.execution.status}: ${result.execution.summary}`)

      // Step 6: Show notification dispatch
      logStep('📡', C.magenta, 'NOTIFICATION', 'Broadcasting to configured channels...')
      console.log(`     ${C.dim}Telegram, Discord, Webhook, Neon mirror${C.reset}`)

      // Step 7: Show event ID
      logStep('📊', C.blue, 'RECORDED', `Event ID: ${result.event.id}`)

    } catch (err) {
      logStep('❌', C.red, 'ERROR', `${err instanceof Error ? err.message : String(err)}`)
    }

    // Wait 1 minute between cycles (or skip if last cycle)
    if (cycle < maxCycles) {
      console.log()
      console.log(`  ${C.dim}⏳ Next cycle in 60 seconds...${C.reset}`)

      // Evolve the demo state slightly between cycles
      demoState.runwayDays = Math.max(0.5, demoState.runwayDays - 0.3 + (Math.random() * 0.2))
      demoState.availableUSDFC = Math.max(0.1, demoState.availableUSDFC - 0.5 + (Math.random() * 0.3))
      demoState.observedAt = new Date().toISOString()

      await new Promise(r => setTimeout(r, 60_000))
    }
  }

  banner('🏁', 'DEMO COMPLETE', C.green)
  console.log(`  ${C.dim}Total cycles: ${maxCycles}  |  Duration: ${Math.round((Date.now() - demoStartTime) / 1000)}s${C.reset}`)
  console.log(`  ${C.dim}Run \x1b[36mfourier start\x1b[0m to begin the live agent loop.${C.reset}`)
  console.log()
}
