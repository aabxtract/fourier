import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  CompiledPolicy,
  Decision,
  FourierConfig,
  Scenario,
  WatcherState,
  ExecutionResult,
  AgentRequest
} from '../types.js'
import { parseDecision } from './decision-schema.js'
import { enforceGuardrails, type GuardrailResult } from './guardrails.js'
import { execute } from './executor.js'
import { EventStore, hashProposal, type EventRecord } from './store.js'
import { ApprovalStore, type Approval } from './approvals.js'
import { MemoryStore, evaluatePreviousOutcome, formatMemoryContext } from './memory.js'
import {
  createRequestStore,
  executeFilecoinPayTransfer,
  type RequestStoreLike
} from './delegation.js'
import { deriveBurnRate, naiveRunwayDays, projectRunwayDays } from './history.js'
import { proposeFromScenario } from './propose.js'
import { Brain } from './brain.js'
import { Watcher } from './watcher.js'
import { getSharedFourierClient } from './synapse.js'
import { syncEventOutbox } from './sync.js'
import { updateMemoryMd } from './workspace.js'
import { NotificationManager } from '../notifications/index.js'
import { TelegramListener } from '../notifications/telegram-listener.js'
import { DiscordListener } from '../notifications/discord-listener.js'
import { AgentLogger, classifyError } from './logger.js'
import { loadEnvSecrets } from './config.js'
import { AccessCodeStore, viewLink } from './access-code.js'

export type ProposeFunction = (
  state: WatcherState,
  policy: CompiledPolicy,
  provider?: any
) => Promise<string | { raw: string; decision: Decision }> | string | { raw: string; decision: Decision }

export interface CheckDeps {
  store: EventStore
  approvals: ApprovalStore
  memory?: MemoryStore
  requests?: RequestStoreLike
  notifications?: NotificationManager
  mode: 'live' | 'simulate'
  scenario?: Scenario
  readState?: () => Promise<WatcherState>
  propose?: ProposeFunction
}

export interface CheckResult {
  event: EventRecord
  approval: Approval | null
  delegationRequest?: AgentRequest | null
  execution: ExecutionResult
}

export class CheckError extends Error {
  constructor(
    message: string,
    readonly stage: 'watcher' | 'model' | 'executor' | 'delegation'
  ) {
    super(message)
  }
}

/**
 * Executes a single resilient check cycle following the 10-step pipeline.
 */
export async function runOneCheck(
  config: FourierConfig,
  policy: CompiledPolicy,
  deps: CheckDeps
): Promise<CheckResult> {
  const logger = new AgentLogger(config.agentId)
  const memoryStore = deps.memory || new MemoryStore('.fourier')
  const requestStore = deps.requests || createRequestStore('.fourier')
  const notificationMgr = deps.notifications || new NotificationManager()
  // Live Synapse client resolved once per check; null when no wallet is
  // configured (simulate mode and demo-fixture paths never need a signer).
  const synapseClient =
    deps.mode === 'live'
      ? getSharedFourierClient({ network: config.network, walletAddress: config.walletAddress })
      : null

  // 1. Acquire State
  let state: WatcherState
  if (deps.mode === 'simulate') {
    if (deps.scenario) {
      state = deps.scenario.state
    } else if (deps.readState) {
      state = await deps.readState()
    } else {
      const watcher = new Watcher({ network: config.network, walletAddress: config.walletAddress })
      state = await watcher.readState()
    }
  } else {
    if (deps.readState) {
      state = await deps.readState()
    } else {
      const watcher = new Watcher({ network: config.network, walletAddress: config.walletAddress })
      state = await watcher.readState()
    }
  }

  // 2. Evaluate Previous Memory Outcome (k-1 evaluation on cycle k)
  const pendingMemory = memoryStore.getPendingOutcome(config.agentId)
  if (pendingMemory) {
    const outcome = evaluatePreviousOutcome(pendingMemory, state, policy.actionRunwayDays)
    memoryStore.updateOutcome(pendingMemory.id, outcome)
  }

  // 3. Retrieve Context: Fetch last 10 memory records
  const recentMemory = memoryStore.getRecent(config.agentId, 10)
  const memoryBlock = formatMemoryContext(recentMemory)

  // 4. Record history & derive burn projections
  const history = deps.scenario?.history ?? []
  const burnRate = deriveBurnRate(history)
  const projections = {
    naiveDays: naiveRunwayDays(state),
    historyAwareDays: projectRunwayDays(state, history),
    burnRateUSDFCPerDay: burnRate
  }

  // Handle Multi-Agent Roles
  let delegationRequest: AgentRequest | null = null

  // 5 & 6. Brain Inference & Validation
  let rawOutput = ''
  let proposal: Decision

  if (deps.propose) {
    const res = await deps.propose(state, policy, config.model.provider)
    if (typeof res === 'string') {
      rawOutput = res
      proposal = parseDecision(res, state)
    } else {
      rawOutput = res.raw || JSON.stringify(res.decision)
      proposal = res.decision
    }
  } else if (deps.scenario) {
    rawOutput = proposeFromScenario(state, deps.scenario.history, config.model.provider)
    proposal = parseDecision(rawOutput, state)
  } else {
    const brain = new Brain({ config, policy, memoryPromptBlock: memoryBlock })
    const res = await brain.propose(state)
    rawOutput = res.raw
    proposal = res.decision
  }

  const proposalHash = hashProposal(rawOutput || '{}')

  // 7. Deterministic Guardrails
  const guardrail: GuardrailResult = enforceGuardrails(proposal, state, policy)
  const decision: Decision =
    guardrail.status === 'hold' || guardrail.status === 'allow' ? guardrail.decision : proposal

  // 8. Role-Based Execution Dispatch
  let approval: Approval | null = null
  let execution: ExecutionResult

  if (guardrail.status === 'approval_required') {
    approval = deps.approvals.create(proposal)
    execution = {
      status: 'awaiting_approval',
      summary: `Approval required. /approve ${approval.token}`,
      transactionId: null
    }
  } else if (config.role === 'child' && decision.action === 'TOP_UP') {
    // Child agent posts request to Treasury instead of self-funding
    const targetTreasury = config.treasuryAgentId || 'treasury-main'
    delegationRequest = await requestStore.createRequest(
      config.agentId,
      targetTreasury,
      decision.amountUSDFC,
      decision.reasoning,
      null,
      state.walletAddress ?? config.walletAddress ?? null
    )
    execution = {
      status: 'delegated',
      summary: `Posted funding request ${delegationRequest.id} to Treasury (${targetTreasury}) for ${decision.amountUSDFC} USDFC.`,
      transactionId: null
    }
  } else if (config.role === 'treasury') {
    // Treasury agent evaluates pending child requests
    const pending = await requestStore.getPendingForTreasury(config.agentId)
    if (pending.length > 0) {
      const targetReq = pending[0]
      const brain = new Brain({ config, policy, memoryPromptBlock: memoryBlock })
      const evalRes = await brain.evaluateTreasuryRequest(targetReq, state)

      if (evalRes.decision.action === 'APPROVE') {
        const transferRes = await executeFilecoinPayTransfer(
          state,
          targetReq,
          evalRes.decision.transferAmountUSDFC,
          deps.mode,
          synapseClient
        )
        if (transferRes.status === 'failed') {
          execution = {
            status: 'failed',
            summary: `Treasury approval of request ${targetReq.id} could not execute: ${transferRes.error}`,
            transactionId: null
          }
        } else {
          await requestStore.updateStatus(targetReq.id, 'approved', { tx_hash: transferRes.txHash ?? undefined })
          execution = {
            status: deps.mode === 'simulate' ? 'simulated' : 'executed',
            summary: `Treasury approved request ${targetReq.id} and transferred ${evalRes.decision.transferAmountUSDFC} USDFC via Filecoin Pay.`,
            transactionId: transferRes.txHash
          }
        }
      } else {
        await requestStore.updateStatus(targetReq.id, 'rejected', {
          rejection_reason: evalRes.decision.reasoning
        })
        execution = {
          status: 'skipped',
          summary: `Treasury rejected request ${targetReq.id}: ${evalRes.decision.reasoning}`,
          transactionId: null
        }
      }
    } else {
      execution = await execute(decision, { mode: deps.mode }, state, { synapseClient })
    }
  } else {
    // Standalone execution
    execution = await execute(decision, { mode: deps.mode }, state, { synapseClient })
  }

  // 9. Record Memory & Audit Event
  memoryStore.recordDecision(config.agentId, decision, state.runwayDays)

  const event = deps.store.append({
    agentId: config.agentId,
    mode: deps.mode,
    scenario: deps.scenario?.name ?? null,
    state: { ...state, ...({ projections } as object) } as WatcherState,
    proposal,
    proposalHash,
    guardrail: {
      status: guardrail.status,
      ...(guardrail.status === 'hold' ? { reason: guardrail.reason } : {}),
      ...(guardrail.status === 'approval_required' ? { reason: guardrail.reason } : {}),
      ...(guardrail.status === 'allow' ? { clamped: guardrail.clamped } : {})
    },
    decision,
    execution,
    policyVersion: policy.version
  })

  // 10. Fan Out Notifications
  const notifyLevel =
    guardrail.status === 'approval_required'
      ? 'approval'
      : decision.action === 'WARN'
      ? 'warn'
      : 'info'

  // Attach the online-view link when an access code exists (best-effort)
  let viewFooter = ''
  try {
    const codeRecord = new AccessCodeStore('.fourier').load()
    if (codeRecord) viewFooter = `\n\n📊 Live view: ${viewLink(codeRecord.rawCode)}`
  } catch {
    // best-effort — notifications work without the hosted view
  }

  notificationMgr
    .broadcast({
      level: notifyLevel,
      title: `${config.agentId}: ${decision.action}`,
      message: `${execution.summary}\n${decision.reasoning}${viewFooter}`,
      agentId: config.agentId,
      decision,
      timestamp: event.recordedAt
    })
    .catch(err => logger.error('Notification dispatch failed', err))

  return { event, approval, delegationRequest, execution }
}

/**
 * Dedicated delegation poll (default every 5 minutes), independent of the main
 * check loop. Treasury: evaluates and executes ALL pending child requests.
 * Child: detects approved/rejected requests, verifies balance arrival, marks
 * settled, and dispatches alerts. Non-overlapping and failure-isolated.
 */
export async function runDelegationPoll(
  config: FourierConfig,
  policy: CompiledPolicy,
  deps: {
    store: EventStore
    approvals: ApprovalStore
    memory: MemoryStore
    requests: RequestStoreLike
    notifications: NotificationManager
  },
  logger: AgentLogger
): Promise<void> {
  const synapseClient = getSharedFourierClient({ network: config.network, walletAddress: config.walletAddress })

  try {
    if (config.role === 'treasury') {
      const pending = await deps.requests.getPendingForTreasury(config.agentId)
      if (pending.length === 0) return
      logger.info(`Delegation poll: ${pending.length} pending request(s)`)

      for (const request of pending) {
        try {
          const watcher = new Watcher({ network: config.network, walletAddress: config.walletAddress })
          const state = await watcher.readState()
          const brain = new Brain({ config, policy, memoryPromptBlock: '' })
          const evalRes = await brain.evaluateTreasuryRequest(request, state)

          if (evalRes.decision.action === 'APPROVE') {
            const transferRes = await executeFilecoinPayTransfer(
              state,
              request,
              evalRes.decision.transferAmountUSDFC,
              'live',
              synapseClient
            )
            if (transferRes.status === 'failed') {
              logger.error(`Treasury transfer for request ${request.id} failed: ${transferRes.error}`)
              continue
            }
            await deps.requests.updateStatus(request.id, 'approved', { tx_hash: transferRes.txHash ?? undefined })
            logger.info(`Treasury approved ${request.id} (${evalRes.decision.transferAmountUSDFC} USDFC)`)
          } else {
            await deps.requests.updateStatus(request.id, 'rejected', {
              rejection_reason: evalRes.decision.reasoning
            })
            logger.info(`Treasury rejected ${request.id}: ${evalRes.decision.reasoning}`)
          }

          deps.notifications.broadcast({
            level: 'info',
            title: `${config.agentId}: delegation ${evalRes.decision.action.toLowerCase()}`,
            message: `Request ${request.id} from ${request.requesting_agent_id}: ${evalRes.decision.reasoning}`,
            agentId: config.agentId,
            decision: evalRes.decision,
            timestamp: new Date().toISOString()
          }).catch(() => {})
        } catch (err) {
          logger.error(`Delegation poll failed to process request ${request.id}`, err)
        }
      }
    }

    if (config.role === 'child') {
      const mine = await deps.requests.getForRequester(config.agentId)
      const unresolved = mine.filter(r => r.status !== 'pending' && !r.settled_at)
      if (unresolved.length === 0) return

      const watcher = new Watcher({ network: config.network, walletAddress: config.walletAddress })
      const state = await watcher.readState()

      for (const request of unresolved) {
        if (request.status === 'approved') {
          const credited =
            request.tx_hash !== null && state.availableUSDFC > 0
          deps.requests.markSettled(request.id)
          logger.info(
            credited
              ? `Request ${request.id} approved and funds observed (available ${state.availableUSDFC} USDFC).`
              : `Request ${request.id} approved; balance arrival not yet observed.`
          )
        } else if (request.status === 'rejected') {
          deps.requests.markSettled(request.id)
          logger.warn(`Request ${request.id} rejected: ${request.rejection_reason ?? 'no reason given'}`)
        }

        deps.notifications.broadcast({
          level: request.status === 'approved' ? 'info' : 'warn',
          title: `${config.agentId}: request ${request.status}`,
          message:
            request.status === 'approved'
              ? `Funding request ${request.id} approved by treasury (tx ${request.tx_hash ?? 'pending'}).`
              : `Funding request ${request.id} rejected: ${request.rejection_reason ?? 'unspecified'}`,
          agentId: config.agentId,
          timestamp: new Date().toISOString()
        }).catch(() => {})
      }
    }
  } catch (err) {
    logger.error('Delegation poll failed (recoverable, next poll continues)', err)
  }
}

/**
 * Resilient continuous main loop.
 */
export async function runLoop(
  config: FourierConfig,
  policy: CompiledPolicy,
  dataDir = '.fourier'
): Promise<void> {
  const logger = new AgentLogger(config.agentId)
  const lockFile = resolve(dataDir, 'agent.lock')

  if (existsSync(lockFile)) {
    logger.warn(`Process lock file exists at ${lockFile}. Overriding stale lock.`)
  }
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))

  let stopped = false
  const stop = () => {
    logger.info('Shutting down gracefully...')
    stopped = true
    try {
      if (existsSync(lockFile)) unlinkSync(lockFile)
    } catch {
      // ignore
    }
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  const store = new EventStore(dataDir)
  const approvals = new ApprovalStore(dataDir)
  const memory = new MemoryStore(dataDir)
  const requests = createRequestStore(dataDir)
  const notifications = new NotificationManager()

  logger.info(`Starting Fourier agent loop for ${config.agentId} (Interval: ${config.checkIntervalMinutes}m, Role: ${config.role})`)

  // Conversation listeners (Telegram/Discord) run as fire-and-forget async
  // loops so their availability never affects the check schedule.
  const listeners: Array<{ stop: () => void }> = []
  const secrets = loadEnvSecrets()
  if (secrets.telegramBotToken && secrets.telegramChatId) {
    const listener = new TelegramListener(secrets.telegramBotToken, secrets.telegramChatId, config, policy)
    listeners.push(listener)
    listener.start().catch(err => logger.error('Telegram listener crashed', err))
    logger.info('Telegram listener started (/approve and natural-language chat enabled)')
  }
  if (secrets.discordBotToken) {
    const listener = new DiscordListener(secrets.discordBotToken, config, policy)
    listeners.push(listener)
    listener.start().catch(err => logger.error('Discord listener crashed', err))
    logger.info('Discord listener started')
  }

  const startMs = Date.now()
  let cycleCount = 0
  const heartbeatFile = resolve(dataDir, 'heartbeat.json')

  // Dedicated delegation poll cadence (default 5 minutes)
  const delegationPollMs = (config.delegationPollMinutes ?? 5) * 60 * 1000
  let lastDelegationPoll = 0

  while (!stopped) {
    const startedAt = Date.now()

    try {
      const result = await runOneCheck(config, policy, {
        store,
        approvals,
        memory,
        requests,
        notifications,
        mode: 'live'
      })
      cycleCount++
      logger.info(`Check completed: ${result.event.decision.action} (${result.execution.status})`)

      // Keep workspace MEMORY.md in sync with the last 10 decisions
      try {
        updateMemoryMd(memory.getRecent(config.agentId, 10))
      } catch {
        // Workspace sync is best-effort and never affects the loop
      }

      // Best-effort optional Neon mirror of the local stores (events outbox,
      // memory outcomes, request statuses, access-code registration)
      syncEventOutbox(store, { dataDir, memory, requests, agentId: config.agentId })
        .then(res => {
          if (!res.skipped && res.synced > 0) logger.info(`Synced ${res.synced} event(s) to cloud`)
        })
        .catch(err => logger.error('Cloud sync failed (will retry next cycle)', err))

      // Write heartbeat for `fourier status`
      const uptimeSeconds = Math.floor((Date.now() - startMs) / 1000)
      const intervalMs = config.checkIntervalMinutes * 60 * 1000
      writeFileSync(heartbeatFile, JSON.stringify({
        lastBeatAt: new Date().toISOString(),
        nextBeatAt: new Date(Date.now() + intervalMs).toISOString(),
        uptimeSeconds,
        cycleCount,
        lastDecision: result.event.decision.action
      }))
    } catch (error) {
      const classified = classifyError(error)
      logger.error(`Check failed at stage [${classified.stage}]`, error)
    }

    // Independent delegation poll for child/treasury roles
    if ((config.role === 'treasury' || config.role === 'child') && Date.now() - lastDelegationPoll >= delegationPollMs) {
      lastDelegationPoll = Date.now()
      await runDelegationPoll(config, policy, { store, approvals, memory, requests, notifications }, logger)
    }

    const intervalMs = config.checkIntervalMinutes * 60 * 1000
    const elapsed = Date.now() - startedAt
    const sleepMs = Math.max(1000, intervalMs - elapsed)

    const checkStepMs = 1000
    let waited = 0
    while (waited < sleepMs && !stopped) {
      await new Promise(r => setTimeout(r, checkStepMs))
      waited += checkStepMs
    }
  }

  for (const listener of listeners) {
    try {
      listener.stop()
    } catch {
      // ignore
    }
  }

  try {
    if (existsSync(lockFile)) unlinkSync(lockFile)
  } catch {
    // ignore
  }
  logger.info('Fourier agent stopped.')
}
