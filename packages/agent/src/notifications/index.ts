import type { NotificationPayload } from '../types.js'
import type { NotificationResult } from './types.js'
import { TelegramDispatcher } from './telegram.js'
import { DiscordDispatcher } from './discord.js'
import { GenericWebhookDispatcher } from './webhook.js'
import { loadEnvSecrets } from '../core/config.js'

export * from './types.js'
export * from './telegram.js'
export * from './discord.js'
export * from './webhook.js'

export class NotificationManager {
  private dispatchers: Array<{ name: string; send: (p: NotificationPayload) => Promise<NotificationResult> }> = []

  constructor() {
    const secrets = loadEnvSecrets()
    if (secrets.telegramBotToken && secrets.telegramChatId) {
      this.dispatchers.push({
        name: 'telegram',
        send: p => new TelegramDispatcher(secrets.telegramBotToken, secrets.telegramChatId).send(p)
      })
    }
    if (secrets.discordWebhookUrl) {
      this.dispatchers.push({
        name: 'discord',
        send: p => new DiscordDispatcher(secrets.discordWebhookUrl).send(p)
      })
    }
    if (secrets.webhookUrl) {
      this.dispatchers.push({
        name: 'webhook',
        send: p => new GenericWebhookDispatcher(secrets.webhookUrl).send(p)
      })
    }
  }

  async broadcast(payload: NotificationPayload): Promise<NotificationResult[]> {
    if (this.dispatchers.length === 0) return []

    // Execute in parallel; failures never crash the caller
    const results = await Promise.all(
      this.dispatchers.map(d =>
        d.send(payload).catch(err => ({
          channel: d.name as 'telegram' | 'discord' | 'webhook',
          success: false,
          error: err instanceof Error ? err.message : String(err)
        }))
      )
    )

    return results
  }
}
