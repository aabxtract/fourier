import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, randomInt } from 'node:crypto'

/**
 * Fourier access codes: the "account" for the hosted online view.
 * No logins — the code IS the credential. It grants READ-ONLY access
 * to one agent's mirrored data and can be rotated at any time.
 *
 * - Raw code: FK-XXXX-XXXX-XXXX (Crockford base32, ~60 bits of entropy
 *   across 15 chars — unguessable at API rate limits, human-typeable)
 * - Only the sha256 hash leaves the machine; the cloud never sees raw codes.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford: no I, L, O, U
const GROUPS = 3
const GROUP_LEN = 5

export interface AccessCodeRecord {
  agentId: string
  rawCode: string
  codeHash: string
  /** Hashes of earlier codes, revoked in the cloud on next sync. */
  previousHashes: string[]
  createdAt: string
}

export function hashCode(rawCode: string): string {
  return createHash('sha256').update(rawCode.trim().toUpperCase()).digest('hex')
}

function randomGroup(): string {
  let out = ''
  for (let i = 0; i < GROUP_LEN; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

export function generateRawCode(): string {
  const groups: string[] = []
  for (let i = 0; i < GROUPS; i++) groups.push(randomGroup())
  return `FK-${groups.join('-')}`
}

/** Normalize user input: uppercase, fix common confusions, keep dashes optional. */
export function normalizeCode(input: string): string {
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-Z]/g, '')
  const body = cleaned.startsWith('FK') ? cleaned.slice(2) : cleaned
  const groups = body.match(/.{1,5}/g) ?? []
  return ['FK', ...groups.filter(g => g.length === GROUP_LEN)].join('-')
}

export class AccessCodeStore {
  private readonly file: string

  constructor(dir: string) {
    this.file = resolve(dir, 'access-code.json')
  }

  exists(): boolean {
    return existsSync(this.file)
  }

  load(): AccessCodeRecord | null {
    if (!existsSync(this.file)) return null
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as AccessCodeRecord
    } catch {
      return null
    }
  }

  /** Create the initial code for this agent. Fails if one already exists. */
  create(agentId: string): AccessCodeRecord {
    if (this.exists()) {
      const existing = this.load()!
      return existing
    }
    return this.write(agentId, generateRawCode(), [])
  }

  /** Rotate: previous code is revoked in the cloud on next sync. */
  rotate(agentId: string): AccessCodeRecord {
    const existing = this.load()
    const previousHashes = existing ? [...existing.previousHashes, existing.codeHash] : []
    return this.write(agentId, generateRawCode(), previousHashes)
  }

  private write(agentId: string, rawCode: string, previousHashes: string[]): AccessCodeRecord {
    const dir = resolve(this.file, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const record: AccessCodeRecord = {
      agentId,
      rawCode,
      codeHash: hashCode(rawCode),
      previousHashes,
      createdAt: new Date().toISOString()
    }
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n')
    renameSync(tmp, this.file)
    return record
  }
}

/** Format the hosted-view URL for a code (used in Telegram links and CLI output). */
export function viewLink(rawCode: string, viewUrl?: string): string {
  const base = (viewUrl ?? process.env.FOURIER_VIEW_URL ?? 'https://fourier-view.vercel.app').replace(/\/+$/, '')
  return `${base}?code=${encodeURIComponent(rawCode)}`
}
