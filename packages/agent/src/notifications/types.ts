import type { NotificationPayload } from '../types.js'

export interface NotificationResult {
  channel: 'telegram' | 'discord' | 'webhook'
  success: boolean
  error?: string
}

export interface NotificationDispatcher {
  send(payload: NotificationPayload): Promise<NotificationResult>
}
