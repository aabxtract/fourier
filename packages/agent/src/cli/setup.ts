import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { upsertEnvLine, readEnvValue } from '../core/env-store.js'

/**
 * Interactive key setup: prompts for secrets and writes them straight into
 * `.env` so the user never edits the file by hand. Input is masked; the
 * stored value is never printed back (only a short fingerprint).
 */

function fingerprint(secret: string): string {
  const trimmed = secret.trim()
  if (trimmed.length <= 12) return '••••••'
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`
}

/** Hidden input: characters are not echoed (asterisks only). Ctrl+C aborts. */
function askHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    const stdin = process.stdin
    const stdout = process.stdout
    stdout.write(question)

    if (!stdin.isTTY) {
      // Piped/CI fallback: read a plain line (can't mask non-TTY input)
      const rl = createInterface({ input: stdin, output: stdout, terminal: false })
      rl.once('line', line => {
        rl.close()
        resolve(line.trim())
      })
      return
    }

    stdin.setRawMode(true)
    stdin.resume()
    let input = ''
    const onData = (chunk: Buffer) => {
      const c = chunk.toString('utf8')
      if (c === '\r' || c === '\n') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.removeListener('data', onData)
        stdout.write('\n')
        resolve(input)
        return
      }
      if (c === '\u0003') {
        stdout.write('\n')
        process.exit(130)
      }
      if (c === '\u007f' || c === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1)
          stdout.write('\b \b')
        }
        return
      }
      if (c >= ' ' && c <= '~') {
        input += c
        stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })
}

async function askVisible(rl: ReturnType<typeof createInterface>, question: string, fallback: string): Promise<string> {
  const answer = (await rl.question(question)).trim()
  return answer || fallback
}

async function confirm(rl: ReturnType<typeof createInterface>, question: string): Promise<boolean> {
  const answer = (await rl.question(`${question} (y/N) `)).trim().toLowerCase()
  return answer === 'y' || answer === 'yes'
}

/**
 * Full interactive setup flow. Safe to run multiple times: existing values
 * are kept unless the user explicitly overwrites them.
 */
export async function setupCommand(): Promise<void> {
  const envPath = resolve(process.cwd(), '.env')
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)

  console.log('')
  console.log('Fourier key setup — values are written directly to .env (gitignored).')
  console.log('')

  // 1. Private key
  const existingKey = readEnvValue(envPath, 'FOURIER_WALLET_PRIVATE_KEY')
  let writeKey = true
  if (existingKey) {
    console.log(`A wallet key is already configured (${fingerprint(existingKey)}).`)
    if (interactive) {
      writeKey = await confirm(createInterface({ input: process.stdin, output: process.stdout }), 'Overwrite it?')
      if (!writeKey) console.log('Keeping the existing wallet key.')
    } else {
      writeKey = false
    }
  }

  if (writeKey) {
    console.log('Paste your CALIBRATION test wallet private key (input is hidden).')
    console.log('Leave empty to skip — the agent then runs on labeled demo data.')
    const key = interactive
      ? await askHidden('Private key: ')
      : ''
    const trimmed = key.trim()
    if (trimmed) {
      const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`
      upsertEnvLine(envPath, 'FOURIER_WALLET_PRIVATE_KEY', normalized)
      console.log(`Wallet key saved to .env (${fingerprint(normalized)}).`)
    } else {
      console.log('Skipped wallet key.')
    }
  }

  if (!interactive) {
    console.log('')
    console.log('Non-interactive shell detected — interactive prompts skipped.')
    console.log(`Add secrets manually to ${envPath} (see .env.example for the list).`)
    return
  }

  // 2. AI provider key (optional)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const existingModel = readEnvValue(envPath, 'FOURIER_MODEL_API_KEY')
    const wantModel = existingModel
      ? await confirm(rl, `An AI key is already configured (${fingerprint(existingModel)}). Overwrite?`)
      : true
    if (wantModel) {
      console.log('Optional: AI provider API key (Anthropic/OpenAI/Gemini/xAI).')
      const modelKey = (await rl.question('AI key (Enter to skip): ')).trim()
      if (modelKey) {
        upsertEnvLine(envPath, 'FOURIER_MODEL_API_KEY', modelKey)
        console.log(`AI key saved (${fingerprint(modelKey)}).`)
      } else {
        console.log('Skipped AI key — canned demo reasoning will be used.')
      }
    }
  } finally {
    rl.close()
  }

  // 3. Confirmation + security note
  const saved = existsSync(envPath)
  console.log('')
  if (saved) {
    console.log(`Secrets stored in ${envPath} — this file is gitignored and never uploaded.`)
  }
  console.log('')
  console.log('Next steps:')
  console.log('  1. fourier policy compile policy.txt')
  console.log('  2. fourier simulate          (real onchain read, zero transactions)')
  console.log('  3. fourier start             (the live agent loop)')
  console.log('')
}
