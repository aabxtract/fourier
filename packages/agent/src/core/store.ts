import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import type { Decision, WatcherState } from '../types.js'
import type { GuardrailResult } from './guardrails.js'

export interface EventRecord {
  id: string
  agentId: string
  recordedAt: string
  mode: 'live' | 'simulate'
  scenario: string | null
  state: WatcherState
  proposal: Decision
  proposalHash: string
  guardrail: { status: GuardrailResult['status']; reason?: string; clamped?: boolean }
  decision: Decision
  execution: { status: string; summary: string; transactionId: string | null }
  policyVersion?: number
  syncedAt: string | null
}

export function hashProposal(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function newId(): string {
  return `evt_${randomBytes(8).toString('hex')}`
}

const redact = (value: unknown): unknown => value

export class EventStore {
  private readonly file: string

  constructor(dir: string, filename = 'events.jsonl') {
    this.file = resolve(dir, filename)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(this.file)) writeFileSync(this.file, '')
  }

  append(record: Omit<EventRecord, 'id' | 'recordedAt' | 'syncedAt'>): EventRecord {
    const full: EventRecord = {
      ...record,
      id: newId(),
      recordedAt: new Date().toISOString(),
      syncedAt: null
    }
    appendFileSync(this.file, JSON.stringify(redact(full)) + '\n')
    return full
  }

  all(): EventRecord[] {
    const text = readFileSync(this.file, 'utf8').trim()
    if (!text) return []
    return text.split('\n').map(line => JSON.parse(line) as EventRecord)
  }

  unsynced(): EventRecord[] {
    return this.all().filter(event => event.syncedAt === null)
  }

  markSynced(ids: string[]): void {
    const wanted = new Set(ids)
    const updated = this.all().map(event =>
      wanted.has(event.id) ? { ...event, syncedAt: new Date().toISOString() } : event
    )
    this.rewrite(updated)
  }

  latest(n: number): EventRecord[] {
    return this.all().slice(-n)
  }

  private rewrite(events: EventRecord[]): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''))
    renameSync(tmp, this.file)
  }
}
