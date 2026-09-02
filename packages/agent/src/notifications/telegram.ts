import type { NotificationDispatcher, NotificationResult } from './types.js'
import type { NotificationPayload } from '../types.js'

export class TelegramDispatcher implements NotificationDispatcher {
  constructor(private botToken?: string, private chatId?: string) {}

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    if (!this.botToken || !this.chatId) {
      return { channel: 'telegram', success: true }
    }

    try {
      const text = `🤖 *Fourier Alert: ${payload.title}*\n\n${payload.message}\n\n_Agent:_ \`${payload.agentId}\`\n_Time:_ \`${payload.timestamp}\``

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'Markdown'
        }),
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          channel: 'telegram',
          success: false,
          error: `Telegram API responded with ${response.status}: ${await response.text()}`
        }
      }

      return { channel: 'telegram', success: true }
    } catch (err) {
      return {
        channel: 'telegram',
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
}
