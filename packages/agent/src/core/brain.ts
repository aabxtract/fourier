import type {
  CompiledPolicy,
  Decision,
  FourierConfig,
  WatcherState,
  TreasuryDecision,
  AgentRequest
} from '../types.js'
import { getModelAdapter } from '../models/index.js'
import { loadEnvSecrets } from './config.js'
import { parseDecision } from './decision-schema.js'
import { loadWorkspaceFiles, buildWorkspaceSystemPrompt, type WorkspaceContext } from './workspace.js'

export interface BrainOptions {
  config: FourierConfig
  policy: CompiledPolicy
  memoryPromptBlock?: string
  workspace?: WorkspaceContext
}

export class Brain {
  private config: FourierConfig
  private policy: CompiledPolicy
  private memoryPromptBlock: string
  private workspace: WorkspaceContext

  constructor(options: BrainOptions) {
    this.config = options.config
    this.policy = options.policy
    this.memoryPromptBlock = options.memoryPromptBlock || '## Previous decisions and outcomes (last 10)\nNo previous records.'
    this.workspace = options.workspace || loadWorkspaceFiles()
  }

  private resolveApiKey(): string | undefined {
    const secrets = loadEnvSecrets()
    if (this.config.model.provider === 'groq') {
      return secrets.groqApiKey || secrets.modelApiKey
    }
    return secrets.modelApiKey
  }

  async propose(state: WatcherState): Promise<{ raw: string; decision: Decision }> {
    const apiKey = this.resolveApiKey()
    const adapter = getModelAdapter(this.config.model.provider)

    const systemPrompt = buildWorkspaceSystemPrompt(
      this.workspace,
      JSON.stringify(this.policy, null, 2),
      this.memoryPromptBlock
    )

    const userPrompt = [
      `Current Observed Account State:`,
      `- Observed At: ${state.observedAt}`,
      `- Current Runway: ${state.runwayDays.toFixed(2)} days`,
      `- Available Funds: ${state.availableUSDFC.toFixed(4)} USDFC`,
      `- Locked Funds: ${state.lockedUSDFC.toFixed(4)} USDFC`,
      `- Observed Spend Rate: ${state.spendRateUSDFCPerDay !== null ? `${state.spendRateUSDFCPerDay.toFixed(2)} USDFC/day` : 'insufficient historical samples'}`,
      `- Active Datasets: ${JSON.stringify(state.datasets)}`,
      '',
      'Propose an action in valid JSON:'
    ].join('\n')

    try {
      const response = await adapter.complete({
        systemPrompt,
        userPrompt,
        modelName: this.config.model.model,
        apiKey,
        responseFormat: 'json'
      })

      const decision = parseDecision(response.raw, state)
      return { raw: response.raw, decision }
    } catch (err) {
      const raw = JSON.stringify({
        action: 'HOLD',
        reasoning: `Model inference error: ${err instanceof Error ? err.message : String(err)}`
      })
      return { raw, decision: { action: 'HOLD', reasoning: `Model inference error: ${err instanceof Error ? err.message : String(err)}` } }
    }
  }

  async evaluateTreasuryRequest(
    request: AgentRequest,
    treasuryState: WatcherState
  ): Promise<{ raw: string; decision: TreasuryDecision }> {
    const apiKey = this.resolveApiKey()
    const adapter = getModelAdapter(this.config.model.provider)

    const systemPrompt = [
      'You are the Treasury Agent for a Fourier multi-agent storage system on Filecoin.',
      'Your responsibility is to evaluate funding requests from child storage agents.',
      'Return ONLY a valid JSON object matching the TreasuryDecision schema:',
      '- { "action": "APPROVE", "requestId": string, "transferAmountUSDFC": number, "reasoning": string }',
      '- { "action": "REJECT", "requestId": string, "reasoning": string }',
      '',
      '### TREASURY POLICY LIMITS:',
      JSON.stringify(this.policy, null, 2)
    ].join('\n')

    const userPrompt = [
      `Pending Child Agent Funding Request:`,
      `- Request ID: ${request.id}`,
      `- Requesting Agent: ${request.requesting_agent_id}`,
      `- Amount Requested: ${request.amount_requested} USDFC`,
      `- Reason: ${request.reason}`,
      '',
      `Current Treasury State:`,
      `- Treasury Available Funds: ${treasuryState.availableUSDFC.toFixed(4)} USDFC`,
      `- Treasury Runway: ${treasuryState.runwayDays.toFixed(2)} days`,
      '',
      'Evaluate this request and return your decision JSON:'
    ].join('\n')

    try {
      const response = await adapter.complete({
        systemPrompt,
        userPrompt,
        modelName: this.config.model.model,
        apiKey,
        responseFormat: 'json'
      })

      const rawTrimmed = response.raw.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(rawTrimmed) as Record<string, unknown>

      if (parsed.action === 'APPROVE' && typeof parsed.transferAmountUSDFC === 'number') {
        const approvedAmount = Math.min(parsed.transferAmountUSDFC, request.amount_requested, this.policy.maxAutoTopUpUSDFC)
        return {
          raw: response.raw,
          decision: {
            action: 'APPROVE',
            requestId: request.id,
            transferAmountUSDFC: approvedAmount,
            reasoning: String(parsed.reasoning || 'Approved child funding request')
          }
        }
      }

      return {
        raw: response.raw,
        decision: {
          action: 'REJECT',
          requestId: request.id,
          reasoning: String(parsed.reasoning || 'Request rejected based on treasury policy')
        }
      }
    } catch (err) {
      // Deterministic evaluation fallback
      if (treasuryState.availableUSDFC >= request.amount_requested && request.amount_requested <= this.policy.maxAutoTopUpUSDFC) {
        return {
          raw: '{"action":"APPROVE"}',
          decision: {
            action: 'APPROVE',
            requestId: request.id,
            transferAmountUSDFC: request.amount_requested,
            reasoning: `Auto-approved: Treasury has sufficient balance (${treasuryState.availableUSDFC} USDFC) to fund ${request.amount_requested} USDFC.`
          }
        }
      }

      return {
        raw: '{"action":"REJECT"}',
        decision: {
          action: 'REJECT',
          requestId: request.id,
          reasoning: `Treasury unable to approve: requested ${request.amount_requested} exceeds limits or available funds.`
        }
      }
    }
  }
}

