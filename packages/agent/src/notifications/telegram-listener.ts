import { ConversationEngine } from '../core/conversation.js'
import { ApprovalStore } from '../core/approvals.js'
import { AgentLogger } from '../core/logger.js'
import type { FourierConfig, CompiledPolicy } from '../types.js'

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number }
    from?: { first_name?: string }
    text?: string
    date: number
  }
}

/**
 * TelegramListener uses long polling to receive and respond to messages.
 * It runs alongside the heartbeat loop as a non-blocking async listener.
 * Only responds to messages from the configured FOURIER_TELEGRAM_CHAT_ID.
 */
export class TelegramListener {
  private botToken: string
  private chatId: string
  private engine: ConversationEngine
  private logger: AgentLogger
  private offset = 0
  private running = false
  private readonly pollTimeoutSec = 30

  constructor(
    botToken: string,
    chatId: string,
    config: FourierConfig,
    policy: CompiledPolicy
  ) {
    this.botToken = botToken
    this.chatId = chatId
    this.engine = new ConversationEngine(config, policy, new ApprovalStore('.fourier'))
    this.logger = new AgentLogger(config.agentId)
  }

  async start(): Promise<void> {
    this.running = true
    this.logger.info('Telegram listener started — awaiting messages')

    while (this.running) {
      try {
        const updates = await this.getUpdates()
        for (const update of updates) {
          if (update.message?.text && String(update.message.chat.id) === this.chatId) {
            await this.handleMessage(update.message.text, update.message.chat.id)
          }
          this.offset = update.update_id + 1
        }
      } catch (err) {
        // Polling errors are recoverable — log and retry after a delay
        this.logger.error('Telegram polling error', err)
        await this.sleep(5000)
      }
    }
  }

  stop(): void {
    this.running = false
    this.logger.info('Telegram listener stopping')
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), (this.pollTimeoutSec + 5) * 1000)

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.offset}&timeout=${this.pollTimeoutSec}`,
        { signal: controller.signal }
      )
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.status}`)
      }

      const data = (await response.json()) as { ok: boolean; result: TelegramUpdate[] }
      return data.ok ? data.result : []
    } catch (err) {
      clearTimeout(timeoutId)
      if ((err as Error).name === 'AbortError') return []
      throw err
    }
  }

  private async handleMessage(text: string, chatId: number): Promise<void> {
    this.logger.info(`Received Telegram message: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`)

    const result = await this.engine.handleMessage(text, 'telegram')

    // Send response back
    await this.sendMessage(chatId, result.response)

    if (result.updatedPreferences) {
      this.logger.info('User preferences updated via Telegram')
    }
    if (result.triggeredSimulation) {
      this.logger.info('Simulation triggered via Telegram conversation')
    }
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    // Telegram has a 4096 character limit per message
    const chunks = this.chunkText(text, 4000)

    for (const chunk of chunks) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            parse_mode: 'Markdown'
          }),
          signal: controller.signal
        })
        clearTimeout(timeoutId)
      } catch (err) {
        this.logger.error('Failed to send Telegram response', err)
        // Try again without markdown in case formatting caused the error
        try {
          await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk
            })
          })
        } catch {
          // Give up on this chunk
        }
      }
    }
  }

  private chunkText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text]
    const chunks: string[] = []
    let remaining = text
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining)
        break
      }
      // Try to break at a newline
      let breakIdx = remaining.lastIndexOf('\n', maxLen)
      if (breakIdx <= 0) breakIdx = maxLen
      chunks.push(remaining.slice(0, breakIdx))
      remaining = remaining.slice(breakIdx)
    }
    return chunks
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }
}
