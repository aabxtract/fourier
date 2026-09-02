export type ErrorStage =
  | 'watcher'
  | 'model'
  | 'validation'
  | 'guardrails'
  | 'executor'
  | 'delegation'
  | 'notification'
  | 'sync'
  | 'unknown'

export interface ClassifiedError {
  stage: ErrorStage
  message: string
  timestamp: string
  recoverable: boolean
}

export function classifyError(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err)
  const timestamp = new Date().toISOString()

  if (message.includes('WatcherError') || message.includes('onchain') || message.includes('RPC')) {
    return { stage: 'watcher', message, timestamp, recoverable: true }
  }
  if (message.includes('Model') || message.includes('inference') || message.includes('API error')) {
    return { stage: 'model', message, timestamp, recoverable: true }
  }
  if (message.includes('validation') || message.includes('schema')) {
    return { stage: 'validation', message, timestamp, recoverable: true }
  }
  if (message.includes('execute') || message.includes('tx')) {
    return { stage: 'executor', message, timestamp, recoverable: false }
  }
  if (message.includes('Telegram') || message.includes('Discord') || message.includes('Webhook')) {
    return { stage: 'notification', message, timestamp, recoverable: true }
  }
  return { stage: 'unknown', message, timestamp, recoverable: true }
}

export class AgentLogger {
  constructor(private agentId: string) {}

  info(msg: string, extra?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString()
    console.log(`[${timestamp}] [INFO] [${this.agentId}] ${msg}`, extra ? JSON.stringify(extra) : '')
  }

  warn(msg: string, extra?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString()
    console.warn(`[${timestamp}] [WARN] [${this.agentId}] ${msg}`, extra ? JSON.stringify(extra) : '')
  }

  error(msg: string, err?: unknown): void {
    const timestamp = new Date().toISOString()
    const classified = classifyError(err || msg)
    console.error(`[${timestamp}] [ERROR] [${this.agentId}] [${classified.stage}] ${msg}`, classified.message)
  }
}
