import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadEnvSecrets } from './config.js'
import type { AgentRequest, TreasuryDecision, WatcherState } from '../types.js'
import {
  depositUSDFC,
  getSharedFourierClient,
  type FourierSynapseClient
} from './synapse.js'

export interface RequestStoreLike {
  all(): Promise<AgentRequest[]>
  createRequest(
    requestingAgentId: string,
    treasuryAgentId: string,
    amountRequested: number,
    reason: string,
    userId?: string | null,
    requestingAgentAddress?: string | null
  ): Promise<AgentRequest>
  getPendingForTreasury(treasuryAgentId: string): Promise<AgentRequest[]>
  getForRequester(requestingAgentId: string): Promise<AgentRequest[]>
  getRequestById(id: string): Promise<AgentRequest | null>
  updateStatus(
    id: string,
    status: 'approved' | 'rejected',
    details?: { tx_hash?: string; rejection_reason?: string }
  ): Promise<AgentRequest | null>
  markSettled(id: string): Promise<AgentRequest | null>
}

export class RequestStore implements RequestStoreLike {
  private readonly file: string

  constructor(dir: string, filename = 'requests.jsonl') {
    this.file = resolve(dir, filename)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(this.file)) writeFileSync(this.file, '')
  }

  async all(): Promise<AgentRequest[]> {
    const text = readFileSync(this.file, 'utf8').trim()
    if (!text) return []
    return text.split('\n').map(l => JSON.parse(l) as AgentRequest)
  }

  async createRequest(
    requestingAgentId: string,
    treasuryAgentId: string,
    amountRequested: number,
    reason: string,
    userId: string | null = null,
    requestingAgentAddress: string | null = null
  ): Promise<AgentRequest> {
    const request: AgentRequest = {
      id: `req_${randomBytes(8).toString('hex')}`,
      requesting_agent_id: requestingAgentId,
      treasury_agent_id: treasuryAgentId,
      user_id: userId,
      requesting_agent_address: requestingAgentAddress,
      amount_requested: amountRequested,
      reason,
      status: 'pending',
      created_at: new Date().toISOString()
    }
    const all = await this.all()
    all.push(request)
    this.rewrite(all)
    return request
  }

  async getPendingForTreasury(treasuryAgentId: string): Promise<AgentRequest[]> {
    const all = await this.all()
    return all.filter(r => r.treasury_agent_id === treasuryAgentId && r.status === 'pending')
  }

  async getForRequester(requestingAgentId: string): Promise<AgentRequest[]> {
    const all = await this.all()
    return all.filter(r => r.requesting_agent_id === requestingAgentId)
  }

  async getRequestById(id: string): Promise<AgentRequest | null> {
    const all = await this.all()
    return all.find(r => r.id === id) ?? null
  }

  async updateStatus(
    id: string,
    status: 'approved' | 'rejected',
    details?: { tx_hash?: string; rejection_reason?: string }
  ): Promise<AgentRequest | null> {
    const all = await this.all()
    const target = all.find(r => r.id === id)
    if (!target) return null

    target.status = status
    target.evaluated_at = new Date().toISOString()
    if (details?.tx_hash) target.tx_hash = details.tx_hash
    if (details?.rejection_reason) target.rejection_reason = details.rejection_reason

    this.rewrite(all)
    return target
  }

  async markSettled(id: string): Promise<AgentRequest | null> {
    const all = await this.all()
    const target = all.find(r => r.id === id)
    if (!target) return null
    target.settled_at = new Date().toISOString()
    this.rewrite(all)
    return target
  }

  private rewrite(requests: AgentRequest[]): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, requests.map(r => JSON.stringify(r)).join('\n') + (requests.length ? '\n' : ''))
    renameSync(tmp, this.file)
  }
}

/**
 * Remote request store backed by a coordination server (the self-hosted
 * dashboard host) exposing GET/POST /api/requests and PATCH /api/requests/:id.
 * Selected automatically when FOURIER_DELEGATION_URL is configured, so child
 * and treasury agents can run on different machines.
 */
export class RemoteRequestStore implements RequestStoreLike {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private headers(): Record<string, string> {
    const token = loadEnvSecrets().dashboardToken
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) }
    })
    if (!response.ok) {
      throw new Error(`Delegation API error ${response.status}: ${await response.text()}`)
    }
    return (await response.json()) as T
  }

  async all(): Promise<AgentRequest[]> {
    return this.request<AgentRequest[]>('/api/requests')
  }

  async createRequest(
    requestingAgentId: string,
    treasuryAgentId: string,
    amountRequested: number,
    reason: string,
    userId: string | null = null,
    requestingAgentAddress: string | null = null
  ): Promise<AgentRequest> {
    return this.request<AgentRequest>('/api/requests', {
      method: 'POST',
      body: JSON.stringify({
        requesting_agent_id: requestingAgentId,
        treasury_agent_id: treasuryAgentId,
        user_id: userId,
        requesting_agent_address: requestingAgentAddress,
        amount_requested: amountRequested,
        reason
      })
    })
  }

  async getPendingForTreasury(treasuryAgentId: string): Promise<AgentRequest[]> {
    const all = await this.all()
    return all.filter(r => r.treasury_agent_id === treasuryAgentId && r.status === 'pending')
  }

  async getForRequester(requestingAgentId: string): Promise<AgentRequest[]> {
    const all = await this.all()
    return all.filter(r => r.requesting_agent_id === requestingAgentId)
  }

  async getRequestById(id: string): Promise<AgentRequest | null> {
    const all = await this.all()
    return all.find(r => r.id === id) ?? null
  }

  async updateStatus(
    id: string,
    status: 'approved' | 'rejected',
    details?: { tx_hash?: string; rejection_reason?: string }
  ): Promise<AgentRequest | null> {
    return this.request<AgentRequest>(`/api/requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...details })
    })
  }

  async markSettled(id: string): Promise<AgentRequest | null> {
    return this.request<AgentRequest>(`/api/requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ settled: true })
    })
  }
}

/**
 * Resolve the request store for the current process: remote coordination
 * server when FOURIER_DELEGATION_URL is set, local JSONL otherwise.
 */
export function createRequestStore(dir: string): RequestStoreLike {
  const delegationUrl = loadEnvSecrets().delegationUrl
  return delegationUrl ? new RemoteRequestStore(delegationUrl) : new RequestStore(dir)
}

/**
 * Executes a Filecoin Pay transfer from Treasury to Child wallet address
 * via the Synapse SDK payments contract (deposit with recipient).
 * Never fabricates a transaction hash in live mode.
 */
export async function executeFilecoinPayTransfer(
  treasuryState: WatcherState,
  request: AgentRequest,
  amountUSDFC: number,
  mode: 'live' | 'simulate',
  client?: FourierSynapseClient | null
): Promise<{ txHash: string | null; status: 'executed' | 'simulated' | 'failed'; error?: string }> {
  if (mode === 'simulate') {
    const mockHash = `0x_sim_pay_${randomBytes(16).toString('hex')}`
    return { txHash: mockHash, status: 'simulated' }
  }

  const resolvedClient = client ?? getSharedFourierClient({ network: 'calibration' })
  if (!resolvedClient) {
    return {
      txHash: null,
      status: 'failed',
      error: 'No wallet configured: set FOURIER_WALLET_PRIVATE_KEY for live Filecoin Pay transfers.'
    }
  }

  const recipient = request.requesting_agent_address
  if (!recipient) {
    return {
      txHash: null,
      status: 'failed',
      error: `Request ${request.id} carries no requesting_agent_address; cannot execute Filecoin Pay transfer.`
    }
  }

  try {
    const txHash = await depositUSDFC(resolvedClient, amountUSDFC, recipient)
    return { txHash, status: 'executed' }
  } catch (err) {
    return {
      txHash: null,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export type { TreasuryDecision }

