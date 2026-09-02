import type { NotificationDispatcher, NotificationResult } from './types.js'
import type { NotificationPayload } from '../types.js'

export class GenericWebhookDispatcher implements NotificationDispatcher {
  constructor(private webhookUrl?: string) {}

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    if (!this.webhookUrl) {
      return { channel: 'webhook', success: true }
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          channel: 'webhook',
          success: false,
          error: `Webhook responded with status ${response.status}`
        }
      }

      return { channel: 'webhook', success: true }
    } catch (err) {
      return {
        channel: 'webhook',
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
}
