import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

export async function stopCommand() {
  const root = process.cwd()
  const lockPath = resolve(root, '.fourier', 'agent.lock')

  if (!existsSync(lockPath)) {
    console.log('No Fourier agent is running (no lock file found).')
    return
  }

  let lockData: { pid: number; startedAt: string }
  try {
    lockData = JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch {
    console.log('Lock file is corrupt. Removing it.')
    try { unlinkSync(lockPath) } catch { /* ignore */ }
    return
  }

  console.log(`Sending shutdown signal to Fourier agent (PID: ${lockData.pid})...`)

  try {
    // Check if process exists first
    process.kill(lockData.pid, 0)

    // Send SIGTERM for graceful shutdown
    process.kill(lockData.pid, 'SIGTERM')

    // Wait briefly to confirm shutdown
    let attempts = 0
    const maxAttempts = 10
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 500))
      try {
        process.kill(lockData.pid, 0)
        attempts++
      } catch {
        // Process no longer exists — shutdown complete
        console.log('\x1b[32m✓\x1b[0m Fourier agent stopped successfully.')

        // Clean up lock file if it still exists
        try { if (existsSync(lockPath)) unlinkSync(lockPath) } catch { /* ignore */ }
        return
      }
    }

    console.log('\x1b[33m⚠\x1b[0m Agent is still running after 5 seconds. It may need more time to shut down.')
    console.log('  Try again or force kill with: kill -9 ' + lockData.pid)
  } catch {
    console.log('Process is no longer running. Cleaning up stale lock file.')
    try { unlinkSync(lockPath) } catch { /* ignore */ }
  }
}
