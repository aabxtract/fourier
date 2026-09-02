#!/usr/bin/env node
import {
  initCommand,
  policyCommand,
  simulateCommand,
  startCommand,
  useCommand,
  approveCommand,
  demoCommand,
  statusCommand,
  stopCommand
} from './cli/index.js'

function usage(): never {
  console.error(
    [
      'Fourier v2 — Policy-constrained storage budget agent for Filecoin Onchain Cloud',
      '',
      'Usage:',
      '  fourier init [--role standalone|child|treasury] [--treasuryId <id>]',
      '  fourier policy compile <policy.txt>',
      '  fourier simulate [burn-spike|budget-squeeze]   (named scenario simulation)',
      '  fourier simulate                              (live onchain zero-tx inspection)',
      '  fourier simulate --days <N>                   (historical event replay)',
      '  fourier start [--simulate <scenario>]         (autonomous loop or simulated check)',
      '  fourier status                                (check running agent status & heartbeat)',
      '  fourier stop                                  (gracefully stop running agent)',
      '  fourier demo                                  (run interactive demo sequence)',
      '  fourier approve <token>                       (redeem single-use approval token)',
      '  fourier use <claude|openai|grok|gemini|groq>  (switch active AI model provider)',
      ''
    ].join('\n')
  )
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) usage()

  const [command, ...subargs] = args

  switch (command) {
    case 'init': {
      const roleIndex = subargs.indexOf('--role')
      const role = (roleIndex !== -1 ? subargs[roleIndex + 1] : undefined) as 'standalone' | 'child' | 'treasury' | undefined
      const tIndex = subargs.indexOf('--treasuryId')
      const treasuryId = tIndex !== -1 ? subargs[tIndex + 1] : undefined
      await initCommand({ role, treasuryId })
      break
    }
    case 'policy':
      await policyCommand(subargs[0], subargs[1])
      break
    case 'simulate':
      await simulateCommand(subargs)
      break
    case 'start':
    case 'run':
      await startCommand(subargs)
      break
    case 'status':
      await statusCommand()
      break
    case 'stop':
      await stopCommand()
      break
    case 'demo':
      await demoCommand()
      break
    case 'use':
      await useCommand(subargs[0])
      break
    case 'approve':
      await approveCommand(subargs[0])
      break
    default:
      usage()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
