import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AccessCodeStore, viewLink } from '../core/access-code.js'
import { loadEnvSecrets } from '../core/config.js'

/**
 * `fourier link` — manage the access code for the hosted online view.
 * The code is the only credential: no logins. Printed once here and
 * re-sendable via Telegram (`/link` in chat).
 */
export async function linkCommand(flags: string[] = []): Promise<void> {
  const rotate = flags.includes('--rotate')
  const show = flags.includes('--show')

  const agentId = resolveAgentId()
  const store = new AccessCodeStore('.fourier')

  const record = rotate ? store.rotate(agentId) : store.create(agentId)

  if (show && !record) {
    console.error('No access code yet. Run `fourier link` to create one.')
    process.exit(1)
  }

  const secrets = loadEnvSecrets()
  const link = viewLink(record.rawCode, secrets.viewUrl)

  console.log('')
  if (rotate) {
    console.log('  Access code ROTATED. The previous code stops working after the next sync.')
    console.log('')
  }
  console.log('  Your Fourier access code (read-only view of this agent online):')
  console.log('')
  console.log(`      ${record.rawCode}`)
  console.log('')
  console.log(`  Live view: ${link}`)
  console.log('')
  console.log('  Enter the code — or open the link — on any device to see this')
  console.log('  agent\'s runway, decisions and charts. No login required.')
  console.log('  This code is shown here and via `/link` in your Telegram chat.')
  console.log('')
}

function resolveAgentId(): string {
  const configPath = resolve(process.cwd(), 'fourier.config.json')
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'))
      if (typeof cfg.agentId === 'string' && cfg.agentId.trim()) return cfg.agentId.trim()
    } catch {
      // fall through to default
    }
  }
  return 'fourier-local'
}
