import type { NotificationDispatcher, NotificationResult } from './types.js'
import type { NotificationPayload } from '../types.js'

export class DiscordDispatcher implements NotificationDispatcher {
  constructor(private webhookUrl?: string) {}

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    if (!this.webhookUrl) {
      return { channel: 'discord', success: true }
    }

    try {
      const color =
        payload.level === 'error'
          ? 0xef4444
          : payload.level === 'warn'
          ? 0xf59e0b
          : payload.level === 'approval'
          ? 0x8b5cf6
          : 0x10b981

      const body = {
        embeds: [
          {
            title: `Fourier: ${payload.title}`,
            description: payload.message,
            color,
            fields: [
              { name: 'Agent', value: payload.agentId, inline: true },
              { name: 'Timestamp', value: payload.timestamp, inline: true }
            ],
            footer: { text: 'Fourier Policy-Constrained Agent' }
          }
        ]
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          channel: 'discord',
          success: false,
          error: `Discord Webhook responded with ${response.status}`
        }
      }

      return { channel: 'discord', success: true }
    } catch (err) {
      return {
        channel: 'discord',
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
}
