import type { FourierConfig, WatcherState } from '../types.js'
import { getModelAdapter } from '../models/index.js'
import { loadEnvSecrets } from './config.js'
import { loadWorkspaceFiles, buildConversationSystemPrompt, updateUserMd } from './workspace.js'
import { Watcher } from './watcher.js'
import { MemoryStore, formatMemoryContext } from './memory.js'
import { ApprovalStore } from './approvals.js'
import { AccessCodeStore, viewLink } from './access-code.js'
import { simulate } from './simulate.js'
import type { CompiledPolicy } from '../types.js'
import { AgentLogger } from './logger.js'

export interface ConversationResult {
  response: string
  updatedPreferences: boolean
  triggeredSimulation: boolean
}

/**
 * ConversationEngine handles natural language messages from users via Telegram/Discord.
 * It injects full workspace context + onchain state into the model and returns
 * a natural language response. It also handles `/approve <token>` commands so
 * TRIAGE approval gating works end-to-end from the chat surface.
 */
export class ConversationEngine {
  private config: FourierConfig
  private policy: CompiledPolicy
  private logger: AgentLogger
  private approvals?: ApprovalStore

  constructor(config: FourierConfig, policy: CompiledPolicy, approvals?: ApprovalStore) {
    this.config = config
    this.policy = policy
    this.approvals = approvals
    this.logger = new AgentLogger(config.agentId)
  }

  async handleMessage(userMessage: string, source: 'telegram' | 'discord'): Promise<ConversationResult> {
    // Approval commands short-circuit before any model inference: they must
    // never depend on provider availability.
    const trimmed = userMessage.trim()
    if (trimmed.toLowerCase().startsWith('/approve')) {
      return this.handleApprovalCommand(trimmed)
    }

    // `/link` — send the access code + hosted-view link (deterministic).
    if (trimmed.toLowerCase().startsWith('/link')) {
      try {
        const record = new AccessCodeStore('.fourier').load()
        if (!record) {
          return {
            response: 'No access code yet — run `fourier link` on the machine running this agent to create one.',
            updatedPreferences: false,
            triggeredSimulation: false
          }
        }
        return {
          response: `🔑 Access code: ${record.rawCode}\n📊 Live view: ${viewLink(record.rawCode)}\n\nOpen the link (or enter the code) on any device for a read-only view of this agent — no login needed. Rotate anytime with \`fourier link --rotate\`.`,
          updatedPreferences: false,
          triggeredSimulation: false
        }
      } catch {
        return {
          response: 'Could not read the access code store. Run `fourier link` on the agent machine.',
          updatedPreferences: false,
          triggeredSimulation: false
        }
      }
    }

    const secrets = loadEnvSecrets()
    const workspace = loadWorkspaceFiles()

    // Fetch current onchain state
    let state: WatcherState
    try {
      const watcher = new Watcher({ network: this.config.network, walletAddress: this.config.walletAddress })
      state = await watcher.readState()
    } catch {
      state = {
        observedAt: new Date().toISOString(),
        runwayDays: 0,
        availableUSDFC: 0,
        lockedUSDFC: 0,
        spendRateUSDFCPerDay: null,
        datasets: [],
        source: 'demo-fixture'
      }
    }

    // Build current state block for the prompt
    const stateBlock = [
      `- Observed At: ${state.observedAt}`,
      `- Current Runway: ${state.runwayDays.toFixed(2)} days`,
      `- Available Funds: ${state.availableUSDFC.toFixed(4)} USDFC`,
      `- Locked Funds: ${state.lockedUSDFC.toFixed(4)} USDFC`,
      `- Spend Rate: ${state.spendRateUSDFCPerDay !== null ? `${state.spendRateUSDFCPerDay.toFixed(2)} USDFC/day` : 'unknown'}`,
      `- Active Datasets: ${state.datasets.length > 0 ? state.datasets.map(d => d.id).join(', ') : 'none'}`
    ].join('\n')

    const systemPrompt = buildConversationSystemPrompt(workspace, stateBlock)

    // Detect if this is a preference update
    const isPreferenceUpdate = this.detectPreferenceUpdate(userMessage)
    let updatedPreferences = false

    // Detect if this is a simulation request
    const isSimRequest = this.detectSimulationRequest(userMessage)
    let triggeredSimulation = false
    let simContext = ''

    if (isSimRequest) {
      try {
        const simResult = await simulate('live', this.policy, this.config.model.provider, this.config)
        simContext = `\n\n[SIMULATION RESULT: The simulation ran against live state. Decision: ${JSON.stringify((simResult as unknown as Record<string, unknown>).decision)}. Execution: ${JSON.stringify((simResult as unknown as Record<string, unknown>).execution)}. Include this in your response.]`
        triggeredSimulation = true
      } catch (err) {
        simContext = '\n\n[SIMULATION FAILED: Could not run simulation. Explain that a simulation was attempted but failed.]'
      }
    }

    // Get the model's response
    const adapter = getModelAdapter(this.config.model.provider)
    const apiKey = this.config.model.provider === 'groq'
      ? (secrets.groqApiKey || secrets.modelApiKey)
      : secrets.modelApiKey

    try {
      const response = await adapter.complete({
        systemPrompt: systemPrompt + simContext,
        userPrompt: userMessage,
        modelName: this.config.model.model,
        apiKey,
        temperature: 0.7
      })

      // If this was a preference update, persist it
      if (isPreferenceUpdate) {
        updateUserMd(userMessage, source)
        updatedPreferences = true
      }

      return {
        response: response.raw,
        updatedPreferences,
        triggeredSimulation
      }
    } catch (err) {
      this.logger.error('Conversation inference failed', err)
      return {
        response: `I'm having trouble processing your message right now. My AI model returned an error. Please try again in a moment.`,
        updatedPreferences: false,
        triggeredSimulation: false
      }
    }
  }

  /**
   * Redeem a single-use approval token. Deterministic, no model involvement:
   * unknown/expired/reused tokens are rejected with their concrete reason.
   */
  private handleApprovalCommand(message: string): ConversationResult {
    const token = message.split(/\s+/)[1] ?? ''
    if (!token) {
      return {
        response: '❌ Missing token. Use `/approve <token>` with the token from the approval request.',
        updatedPreferences: false,
        triggeredSimulation: false
      }
    }

    const approvals = this.approvals ?? new ApprovalStore('.fourier')
    const result = approvals.approve(token)

    if (result.ok) {
      this.logger.info(`Approval token redeemed via chat (${result.approval.proposal.action})`)
      return {
        response: `✅ Approved: ${result.approval.proposal.action}. The proposal is recorded and the action it would take is logged. No transaction was sent from this command.`,
        updatedPreferences: false,
        triggeredSimulation: false
      }
    }

    const reasonText: Record<string, string> = {
      'unknown-token': 'token not found',
      'already-used': 'token already used (single-use)',
      'already-approved': 'proposal already approved',
      'expired': 'approval window expired (10 minutes)',
      'tampered': 'proposal hash mismatch'
    }
    return {
      response: `❌ Approval rejected: ${reasonText[result.reason] ?? result.reason}.`,
      updatedPreferences: false,
      triggeredSimulation: false
    }
  }

  /**
   * Detect if a user message contains a preference update intent.
   * Looks for imperative patterns like "never", "always", "set", "change", etc.
   */
  private detectPreferenceUpdate(message: string): boolean {
    const lower = message.toLowerCase().trim()
    const prefixPatterns = [
      'never ', 'always ', 'don\'t ', 'do not ',
      'set ', 'change ', 'update ',
      'i want ', 'i prefer ', 'i need ',
      'make sure ', 'ensure ', 'from now on'
    ]
    return prefixPatterns.some(p => lower.includes(p))
  }

  /**
   * Detect if a user message is requesting a simulation.
   */
  private detectSimulationRequest(message: string): boolean {
    const lower = message.toLowerCase().trim()
    return lower.includes('simulat') ||
           lower.includes('what would happen') ||
           lower.includes('what if') ||
           lower.includes('run a sim') ||
           lower.includes('test scenario')
  }
}
