import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { upsertEnvLine, readEnvValue } from '../core/env-store.js'

/**
 * Interactive key setup: prompts for secrets and writes them straight into
 * `.env` so the user never edits the file by hand. Input is masked; the
 * stored value is never printed back (only a short fingerprint).
 *
 * Telegram chat ID is auto-discovered through the Bot API: paste the bot
 * token, send any message to your bot, and the setup finds your chat id.
 */

const DEFAULT_VIEW_URL = 'https://fourier-view.vercel.app'

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

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))
  ])
}

/** Validate a bot token via getMe; returns the bot username or null. */
export async function telegramBotUsername(token: string): Promise<string | null> {
  try {
    const res = await withTimeout(fetch(`https://api.telegram.org/bot${token}/getMe`), 8000)
    const data = (await res.json()) as { ok: boolean; result?: { username?: string } }
    return data.ok ? data.result?.username ?? null : null
  } catch {
    return null
  }
}

/** Pure: extract the most recent chat id from a getUpdates payload. */
export function parseChatIdFromUpdates(updates: unknown): number | null {
  if (!Array.isArray(updates)) return null
  for (let i = updates.length - 1; i >= 0; i--) {
    const u = updates[i] as { message?: { chat?: { id?: number } }; channel_post?: { chat?: { id?: number } } }
    const chatId = u?.message?.chat?.id ?? u?.channel_post?.chat?.id
    if (typeof chatId === 'number') return chatId
  }
  return null
}

/** Fetch getUpdates for a token; returns the raw result array or null on failure. */
async function telegramUpdates(token: string): Promise<unknown[] | null> {
  try {
    // Webhooks block getUpdates — clear any stale webhook first (best-effort).
    await withTimeout(fetch(`https://api.telegram.org/bot${token}/deleteWebhook`), 8000).catch(() => null)
    const res = await withTimeout(fetch(`https://api.telegram.org/bot${token}/getUpdates`), 8000)
    const data = (await res.json()) as { ok: boolean; result?: unknown[] }
    return data.ok ? data.result ?? [] : null
  } catch {
    return null
  }
}

/**
 * Auto-discover the user's chat id: ask them to message the bot, poll
 * getUpdates, and extract the chat id. Retries up to `retries` times.
 */
export async function discoverTelegramChatId(token: string, rl: ReturnType<typeof createInterface>, retries = 4): Promise<number | null> {
  const updates = await telegramUpdates(token)
  const immediate = parseChatIdFromUpdates(updates)
  if (immediate !== null) return immediate

  for (let attempt = 0; attempt < retries; attempt++) {
    await rl.question(`No message found yet. Open Telegram, send ANY message to your bot, then press Enter to retry (${attempt + 1}/${retries})... `)
    const retryUpdates = await telegramUpdates(token)
    const chatId = parseChatIdFromUpdates(retryUpdates)
    if (chatId !== null) return chatId
  }
  return null
}

async function askVisible(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return (await rl.question(question)).trim()
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
  console.log('Press Enter on any prompt to skip it.')
  console.log('')

  // 1. Wallet private key — the FOC connection
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
    const key = interactive ? await askHidden('Private key: ') : ''
    const trimmed = key.trim()
    if (trimmed) {
      const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`
      upsertEnvLine(envPath, 'FOURIER_WALLET_PRIVATE_KEY', normalized)
      console.log(`Wallet key saved to .env (${fingerprint(normalized)}) — connected to Filecoin Onchain Cloud.`)
    } else {
      console.log('Skipped wallet key — the agent runs on labeled demo data until one is set.')
    }
  }

  if (!interactive) {
    console.log('')
    console.log('Non-interactive shell detected — interactive prompts skipped.')
    console.log(`Add secrets manually to ${envPath} (see .env.example for the list).`)
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    // 2. AI provider key (optional)
    const existingModel = readEnvValue(envPath, 'FOURIER_MODEL_API_KEY')
    const wantModel = existingModel
      ? await confirm(rl, `An AI key is already configured (${fingerprint(existingModel)}). Overwrite?`)
      : true
    if (wantModel) {
      const modelKey = await askVisible(rl, 'AI provider key (Anthropic/OpenAI/Gemini/xAI — Enter to skip): ')
      if (modelKey) {
        upsertEnvLine(envPath, 'FOURIER_MODEL_API_KEY', modelKey)
        console.log(`AI key saved (${fingerprint(modelKey)}).`)
      } else {
        console.log('Skipped AI key — canned demo reasoning will be used.')
      }
    }

    // 3. Telegram: bot token + AUTO-DISCOVERED chat id
    const wantTelegram = await confirm(rl, 'Set up Telegram alerts + chat now?')
    if (wantTelegram) {
      const botToken = await askVisible(rl, 'Telegram bot token (from @BotFather — Enter to skip): ')
      if (botToken) {
        const username = await telegramBotUsername(botToken)
        if (!username) {
          console.log('❌ That token was rejected by Telegram. Check it and re-run `fourier setup`.')
        } else {
          upsertEnvLine(envPath, 'FOURIER_TELEGRAM_BOT_TOKEN', botToken)
          console.log(`Bot verified: @${username}.`)
          console.log('Now finding your chat id — I will message-detect it automatically.')
          const chatId = await discoverTelegramChatId(botToken, rl)
          if (chatId !== null) {
            upsertEnvLine(envPath, 'FOURIER_TELEGRAM_CHAT_ID', String(chatId))
            console.log(`✅ Chat id ${chatId} discovered and saved — alerts + /approve will reach you.`)
          } else {
            console.log('⚠️ Could not detect a chat id. Send a message to your bot and re-run `fourier setup` later.')
          }
        }
      } else {
        console.log('Skipped Telegram.')
      }
    }

    // 4. Discord webhook (optional)
    const wantDiscord = await confirm(rl, 'Set up a Discord webhook for alerts?')
    if (wantDiscord) {
      const webhook = await askVisible(rl, 'Discord webhook URL (Enter to skip): ')
      if (webhook.startsWith('https://')) {
        upsertEnvLine(envPath, 'FOURIER_DISCORD_WEBHOOK_URL', webhook)
        console.log('Discord webhook saved.')
      } else if (webhook) {
        console.log('⚠️ That does not look like a Discord webhook URL — skipped.')
      }
    }

    // 5. Neon cloud mirror + online view (optional)
    const wantCloud = await confirm(rl, 'Set up the Neon cloud mirror (enables the online view on your phone)?')
    if (wantCloud) {
      const dbUrl = await askVisible(rl, 'Neon connection string (postgresql://... — Enter to skip): ')
      if (dbUrl.startsWith('postgresql://')) {
        upsertEnvLine(envPath, 'FOURIER_DATABASE_URL', dbUrl)
        console.log('Neon database saved — the loop mirrors events/memory/requests automatically.')
      } else if (dbUrl) {
        console.log('⚠️ That does not look like a Postgres connection string — skipped.')
      }
      const viewUrl = await askVisible(rl, `Online view URL (Enter for ${DEFAULT_VIEW_URL}): `)
      upsertEnvLine(envPath, 'FOURIER_VIEW_URL', viewUrl || DEFAULT_VIEW_URL)
      console.log('View URL saved — Telegram alerts will carry your personal link.')
    }

    // Summary
    console.log('')
    console.log('Setup summary:')
    const summarize = (key: string, secret: boolean) => {
      const value = readEnvValue(envPath, key)
      console.log(`  ${value ? '✓' : '·'} ${key}: ${value ? (secret ? fingerprint(value) : value) : 'not set'}`)
    }
    summarize('FOURIER_WALLET_PRIVATE_KEY', true)
    summarize('FOURIER_MODEL_API_KEY', true)
    summarize('FOURIER_TELEGRAM_BOT_TOKEN', true)
    summarize('FOURIER_TELEGRAM_CHAT_ID', false)
    summarize('FOURIER_DISCORD_WEBHOOK_URL', true)
    summarize('FOURIER_DATABASE_URL', true)
    summarize('FOURIER_VIEW_URL', false)
    console.log('')
    console.log(`Secrets stored in ${envPath} — gitignored, never uploaded.`)
    console.log('')
    console.log('Next steps:')
    console.log('  Tip: run once for bare `fourier` commands:  npm i -g fourier-agent')
    console.log('  1. npx fourier-agent policy compile policy.txt')
    console.log('  2. npx fourier-agent simulate          (real onchain read, zero transactions)')
    console.log('  3. npx fourier-agent start             (the live agent loop)')
    console.log('')
  } finally {
    rl.close()
  }
}
