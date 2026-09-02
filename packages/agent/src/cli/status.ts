import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export async function statusCommand() {
  const root = process.cwd()
  const lockPath = resolve(root, '.fourier', 'agent.lock')
  const heartbeatPath = resolve(root, '.fourier', 'heartbeat.json')

  console.log()
  console.log('╔══════════════════════════════════════╗')
  console.log('║       Fourier Agent Status            ║')
  console.log('╚══════════════════════════════════════╝')
  console.log()

  // Check lock file
  if (!existsSync(lockPath)) {
    console.log('  Status:  \x1b[31m● STOPPED\x1b[0m')
    console.log('  No agent lock file found.')
    console.log()
    return
  }

  let lockData: { pid: number; startedAt: string }
  try {
    lockData = JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch {
    console.log('  Status:  \x1b[33m● UNKNOWN\x1b[0m')
    console.log('  Lock file exists but is corrupt.')
    console.log()
    return
  }

  // Check if process is still running
  let isAlive = false
  try {
    process.kill(lockData.pid, 0) // Signal 0 = check existence
    isAlive = true
  } catch {
    isAlive = false
  }

  if (!isAlive) {
    console.log('  Status:  \x1b[33m● STALE\x1b[0m (process not found)')
    console.log(`  PID:     ${lockData.pid}`)
    console.log(`  Started: ${lockData.startedAt}`)
    console.log('  The lock file exists but the process is no longer running.')
    console.log('  Run \x1b[36mfourier start\x1b[0m to restart.')
    console.log()
    return
  }

  // Process is alive
  console.log('  Status:  \x1b[32m● RUNNING\x1b[0m')
  console.log(`  PID:     ${lockData.pid}`)
  console.log(`  Started: ${lockData.startedAt}`)

  // Check heartbeat
  if (existsSync(heartbeatPath)) {
    try {
      const hb = JSON.parse(readFileSync(heartbeatPath, 'utf8')) as {
        lastBeatAt: string
        nextBeatAt: string
        uptimeSeconds: number
        cycleCount: number
        lastDecision: string | null
      }

      const uptimeMin = Math.floor(hb.uptimeSeconds / 60)
      const uptimeHrs = Math.floor(uptimeMin / 60)
      const uptimeStr = uptimeHrs > 0
        ? `${uptimeHrs}h ${uptimeMin % 60}m`
        : `${uptimeMin}m`

      console.log(`  Uptime:  ${uptimeStr}`)
      console.log(`  Cycles:  ${hb.cycleCount}`)
      console.log(`  Last Beat:    ${hb.lastBeatAt}`)
      console.log(`  Next Beat:    ${hb.nextBeatAt}`)
      if (hb.lastDecision) {
        console.log(`  Last Decision: ${hb.lastDecision}`)
      }
    } catch {
      console.log('  Heartbeat: \x1b[33munavailable\x1b[0m')
    }
  } else {
    console.log('  Heartbeat: \x1b[33mnot yet written\x1b[0m (first cycle pending)')
  }

  console.log()
}
