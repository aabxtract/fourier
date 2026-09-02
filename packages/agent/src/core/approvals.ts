import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import type { Decision } from '../types.js'

export interface Approval {
  token: string
  decisionHash: string
  proposal: Decision
  createdAt: string
  expiresAt: string
  approvedAt: string | null
  usedAt: string | null
}

export const APPROVAL_TTL_MS = 10 * 60 * 1000

export function decisionHash(decision: Decision): string {
  return createHash('sha256').update(JSON.stringify(decision)).digest('hex')
}

export class ApprovalStore {
  private readonly file: string

  constructor(dir: string) {
    this.file = resolve(dir, 'approvals.json')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(this.file)) this.persist([])
  }

  /** Create a pending approval for an immutable proposal. */
  create(proposal: Decision, now = Date.now()): Approval {
    const approvals = this.load()
    const approval: Approval = {
      token: randomBytes(16).toString('hex'),
      decisionHash: decisionHash(proposal),
      proposal,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + APPROVAL_TTL_MS).toISOString(),
      approvedAt: null,
      usedAt: null
    }
    approvals.push(approval)
    this.persist(approvals)
    return approval
  }

  /**
   * Approve a pending proposal by token. Rejects unknown, expired,
   * reused, or tampered proposals. Single-use.
   */
  approve(token: string, now = Date.now()): { ok: true; approval: Approval } | { ok: false; reason: string } {
    const approvals = this.load()
    const approval = approvals.find(a => a.token === token)
    if (!approval) return { ok: false, reason: 'unknown-token' }
    if (approval.usedAt !== null) return { ok: false, reason: 'already-used' }
    if (approval.approvedAt !== null) return { ok: false, reason: 'already-approved' }
    if (now > new Date(approval.expiresAt).getTime()) return { ok: false, reason: 'expired' }
    if (decisionHash(approval.proposal) !== approval.decisionHash) return { ok: false, reason: 'tampered' }

    approval.approvedAt = new Date(now).toISOString()
    approval.usedAt = approval.approvedAt
    this.persist(approvals)
    return { ok: true, approval }
  }

  get(token: string): Approval | null {
    return this.load().find(a => a.token === token) ?? null
  }

  all(): Approval[] {
    return this.load()
  }

  private load(): Approval[] {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Approval[]
    } catch {
      return []
    }
  }

  private persist(approvals: Approval[]): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(approvals, null, 2) + '\n')
    renameSync(tmp, this.file)
  }
}
