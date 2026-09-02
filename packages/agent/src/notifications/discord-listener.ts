import { ConversationEngine } from '../core/conversation.js'
import { ApprovalStore } from '../core/approvals.js'
import { AgentLogger } from '../core/logger.js'
import type { FourierConfig, CompiledPolicy } from '../types.js'

/**
 * DiscordListener uses the Discord Bot Gateway (WebSocket) to listen for
 * direct messages and respond via the ConversationEngine.
 *
 * Requires FOURIER_DISCORD_BOT_TOKEN — a bot token from the Discord Developer Portal.
 * This is separate from the webhook URL used for one-way notifications.
 */
export class DiscordListener {
  private botToken: string
  private engine: ConversationEngine
  private logger: AgentLogger
  private running = false
  private ws: ReturnType<typeof this.createWebSocket> | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private lastSequence: number | null = null
  private sessionId: string | null = null

  constructor(
    botToken: string,
    config: FourierConfig,
    policy: CompiledPolicy
  ) {
    this.botToken = botToken
    this.engine = new ConversationEngine(config, policy, new ApprovalStore('.fourier'))
    this.logger = new AgentLogger(config.agentId)
  }

  async start(): Promise<void> {
    this.running = true
    this.logger.info('Discord listener starting — connecting to Gateway')

    try {
      // Get the gateway URL
      const gatewayUrl = await this.getGatewayUrl()
      await this.connectToGateway(gatewayUrl)
    } catch (err) {
      this.logger.error('Discord listener failed to start', err)
    }
  }

  stop(): void {
    this.running = false
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.ws) {
      try {
        // Note: ws.close() may not exist on all runtimes
        (this.ws as unknown as { close: () => void }).close?.()
      } catch {
        // ignore
      }
    }
    this.logger.info('Discord listener stopped')
  }

  private async getGatewayUrl(): Promise<string> {
    const response = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers: { Authorization: `Bot ${this.botToken}` }
    })

    if (!response.ok) {
      throw new Error(`Discord Gateway error: ${response.status} — ${await response.text()}`)
    }

    const data = (await response.json()) as { url: string }
    return `${data.url}?v=10&encoding=json`
  }

  private createWebSocket(_url: string): unknown {
    // This is a placeholder for the WebSocket connection.
    // In production, use the 'ws' package or Node.js built-in WebSocket (Node 21+).
    return null
  }

  private async connectToGateway(gatewayUrl: string): Promise<void> {
    // Discord Gateway requires a WebSocket client.
    // For maximum compatibility, we use a polling-based approach via REST API instead.
    // This avoids requiring the 'ws' npm package.
    this.logger.info('Discord listener using REST polling mode')
    await this.restPollLoop()
  }

  /**
   * REST-based polling loop for Discord.
   * Polls for new DMs using the Discord REST API.
   * This is simpler and avoids WebSocket dependencies.
   */
  private async restPollLoop(): Promise<void> {
    let lastMessageId: string | null = null

    while (this.running) {
      try {
        // Get DM channels
        const channels = await this.getDMChannels()

        for (const channelId of channels) {
          const messages = await this.getNewMessages(channelId, lastMessageId)
          for (const msg of messages) {
            if (!msg.author.bot) {
              await this.handleDiscordMessage(msg, channelId)
              if (!lastMessageId || msg.id > lastMessageId) {
                lastMessageId = msg.id
              }
            }
          }
        }
      } catch (err) {
        this.logger.error('Discord polling error', err)
      }

      await this.sleep(5000) // Poll every 5 seconds
    }
  }

  private async getDMChannels(): Promise<string[]> {
    try {
      const response = await fetch('https://discord.com/api/v10/users/@me/channels', {
        headers: { Authorization: `Bot ${this.botToken}` }
      })

      if (!response.ok) return []

      const data = (await response.json()) as Array<{ id: string; type: number }>
      // Type 1 = DM channels
      return data.filter(c => c.type === 1).map(c => c.id)
    } catch {
      return []
    }
  }

  private async getNewMessages(
    channelId: string,
    afterId: string | null
  ): Promise<Array<{ id: string; content: string; author: { id: string; bot: boolean } }>> {
    try {
      const url = afterId
        ? `https://discord.com/api/v10/channels/${channelId}/messages?after=${afterId}&limit=10`
        : `https://discord.com/api/v10/channels/${channelId}/messages?limit=1`

      const response = await fetch(url, {
        headers: { Authorization: `Bot ${this.botToken}` }
      })

      if (!response.ok) return []

      return (await response.json()) as Array<{
        id: string
        content: string
        author: { id: string; bot: boolean }
      }>
    } catch {
      return []
    }
  }

  private async handleDiscordMessage(
    msg: { id: string; content: string; author: { id: string; bot: boolean } },
    channelId: string
  ): Promise<void> {
    this.logger.info(`Received Discord message: "${msg.content.slice(0, 80)}${msg.content.length > 80 ? '...' : ''}"`)

    const result = await this.engine.handleMessage(msg.content, 'discord')

    // Send response back to the DM channel
    await this.sendDiscordMessage(channelId, result.response)

    if (result.updatedPreferences) {
      this.logger.info('User preferences updated via Discord')
    }
    if (result.triggeredSimulation) {
      this.logger.info('Simulation triggered via Discord conversation')
    }
  }

  private async sendDiscordMessage(channelId: string, content: string): Promise<void> {
    // Discord has a 2000 character limit per message
    const chunks = this.chunkText(content, 1900)

    for (const chunk of chunks) {
      try {
        await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${this.botToken}`
          },
          body: JSON.stringify({ content: chunk })
        })
      } catch (err) {
        this.logger.error('Failed to send Discord response', err)
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
