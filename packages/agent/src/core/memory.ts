import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AgentMemoryRecord, Decision, WatcherState } from '../types.js'

export class MemoryStore {
  private readonly file: string

  constructor(dir: string, filename = 'memory.jsonl') {
    this.file = resolve(dir, filename)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(this.file)) writeFileSync(this.file, '')
  }

  all(agentId?: string): AgentMemoryRecord[] {
    const text = readFileSync(this.file, 'utf8').trim()
    if (!text) return []
    const records = text.split('\n').map(l => JSON.parse(l) as AgentMemoryRecord)
    if (agentId) return records.filter(r => r.agent_id === agentId)
    return records
  }

  getRecent(agentId: string, limit = 10): AgentMemoryRecord[] {
    const records = this.all(agentId)
    return records.slice(-limit)
  }

  getPendingOutcome(agentId: string): AgentMemoryRecord | null {
    const records = this.all(agentId)
    for (let i = records.length - 1; i >= 0; i--) {
      if (!records[i].outcome) return records[i]
    }
    return null
  }

  recordDecision(
    agentId: string,
    decision: Decision,
    runwayDays: number,
    userId: string | null = null
  ): AgentMemoryRecord {
    const record: AgentMemoryRecord = {
      id: `mem_${randomBytes(8).toString('hex')}`,
      agent_id: agentId,
      user_id: userId,
      action: decision.action,
      runway_days_at_decision: runwayDays,
      amount_if_topup: decision.action === 'TOP_UP' ? decision.amountUSDFC : null,
      outcome: null,
      created_at: new Date().toISOString()
    }
    const all = this.all()
    all.push(record)
    this.rewrite(all)
    return record
  }

  updateOutcome(id: string, outcome: string): void {
    const all = this.all()
    const target = all.find(r => r.id === id)
    if (target) {
      target.outcome = outcome
      this.rewrite(all)
    }
  }

  private rewrite(records: AgentMemoryRecord[]): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''))
    renameSync(tmp, this.file)
  }
}

/**
 * Evaluate outcome of previous decision D_{k-1} against current observed state S_k.
 */
export function evaluatePreviousOutcome(
  prevRecord: AgentMemoryRecord,
  currentState: WatcherState,
  actionThresholdDays: number
): string {
  const currentRunway = currentState.runwayDays
  const prevRunway = prevRecord.runway_days_at_decision

  if (prevRecord.action === 'TOP_UP') {
    if (currentRunway > prevRunway) {
      return `SUCCESS (runway extended to ${currentRunway.toFixed(1)} days)`
    }
    return `EXECUTED (top-up applied, current runway: ${currentRunway.toFixed(1)} days)`
  }

  if (prevRecord.action === 'HOLD') {
    if (currentRunway <= actionThresholdDays) {
      return `FAILED (rapid burn rate caused critical drop to ${currentRunway.toFixed(1)}d before next cycle)`
    }
    return `STABLE (runway maintained at ${currentRunway.toFixed(1)} days)`
  }

  if (prevRecord.action === 'WARN') {
    if (currentRunway <= actionThresholdDays) {
      return `ESCALATED (runway declined to ${currentRunway.toFixed(1)} days)`
    }
    return `STABILIZED (runway at ${currentRunway.toFixed(1)} days)`
  }

  if (prevRecord.action === 'TRIAGE') {
    return `COMPLETED (triage policy prioritized datasets; runway at ${currentRunway.toFixed(1)} days)`
  }

  return `OBSERVED (current runway: ${currentRunway.toFixed(1)} days)`
}

/**
 * Format the last 10 memory records into the prompt section.
 */
export function formatMemoryContext(records: AgentMemoryRecord[]): string {
  if (records.length === 0) {
    return '## Previous decisions and outcomes (last 10)\nNo previous memory records found. This is the initial cycle.'
  }

  const lines = records.map(r => {
    const dateStr = r.created_at.slice(0, 16).replace('T', ' ')
    const topupStr = r.amount_if_topup ? ` (${r.amount_if_topup} USDFC)` : ''
    const outcomeStr = r.outcome ? r.outcome : 'PENDING EVALUATION'
    return `- [${dateStr}] Action: ${r.action}${topupStr} at ${r.runway_days_at_decision.toFixed(1)}d runway -> Outcome: ${outcomeStr}`
  })

  return `## Previous decisions and outcomes (last 10)\n${lines.join('\n')}`
}
