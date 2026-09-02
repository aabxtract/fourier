export type Provider = 'claude' | 'openai' | 'grok' | 'gemini' | 'groq'

export type AgentRole = 'standalone' | 'child' | 'treasury'

export interface CompiledPolicy {
  version: number
  warningRunwayDays: number
  actionRunwayDays: number
  maxAutoTopUpUSDFC: number
  datasetPriority: string[]
  topUpEnabled: boolean
  triageEnabled: boolean
  triageRequiresApproval: boolean
}

export interface DatasetState {
  id: string
  status: string
  pieceCount: number
}

export interface HistoryPoint {
  observedAt: string
  availableUSDFC: number
}

export interface WatcherState {
  observedAt: string
  runwayDays: number
  availableUSDFC: number
  lockedUSDFC: number
  spendRateUSDFCPerDay: number | null
  datasets: DatasetState[]
  /**
   * 'live' — observed through the Synapse SDK against the configured network.
   * 'scenario' — deterministic fixture loaded for simulation.
   * 'demo-fixture' — canned healthy state used when no live client is configured.
   */
  source: 'live' | 'scenario' | 'demo-fixture'
  walletAddress?: string
}

export type Decision =
  | { action: 'HOLD'; reasoning: string }
  | { action: 'WARN'; reasoning: string }
  | { action: 'TOP_UP'; amountUSDFC: number; reasoning: string }
  | {
      action: 'TRIAGE'
      rankedDatasetIds: string[]
      reasoning: string
    }

export type TreasuryDecision =
  | { action: 'APPROVE'; requestId: string; transferAmountUSDFC: number; reasoning: string }
  | { action: 'REJECT'; requestId: string; reasoning: string }

export interface AgentMemoryRecord {
  id: string
  agent_id: string
  user_id?: string | null
  action: 'TOP_UP' | 'TRIAGE' | 'HOLD' | 'WARN'
  runway_days_at_decision: number
  amount_if_topup: number | null
  outcome: string | null
  created_at: string
}

export interface AgentRequest {
  id: string
  requesting_agent_id: string
  treasury_agent_id: string
  user_id?: string | null
  /** Child agent wallet address, used by the treasury for the Filecoin Pay transfer. */
  requesting_agent_address?: string | null
  amount_requested: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  evaluated_at?: string | null
  tx_hash?: string | null
  rejection_reason?: string | null
  /** Set by the child once an approved transfer's balance arrival is verified. */
  settled_at?: string | null
}

export interface FourierConfig {
  agentId: string
  network: 'calibration' | 'mainnet'
  role: AgentRole
  treasuryAgentId: string | null
  walletAddress?: string
  model: { provider: Provider; model: string }
  thresholds: Pick<CompiledPolicy, 'warningRunwayDays' | 'actionRunwayDays' | 'maxAutoTopUpUSDFC'>
  actions: Pick<CompiledPolicy, 'topUpEnabled' | 'triageEnabled' | 'triageRequiresApproval'>
  checkIntervalMinutes: number
  /** Dedicated delegation poll cadence for child/treasury roles (minutes). */
  delegationPollMinutes?: number
}

export interface ExecutionContext {
  mode: 'live' | 'simulate'
  scenario?: string
  replayDays?: number
}

export interface ExecutionResult {
  status: 'simulated' | 'executed' | 'skipped' | 'awaiting_approval' | 'delegated' | 'failed' | 'unsupported'
  summary: string
  transactionId: string | null
  estimatedNewRunwayDays?: number | null
}

export interface Scenario {
  name: string
  state: WatcherState
  history: HistoryPoint[]
  expected: string
}

export interface NotificationPayload {
  level: 'info' | 'warn' | 'error' | 'approval'
  title: string
  message: string
  agentId: string
  decision?: Decision | TreasuryDecision
  timestamp: string
}
