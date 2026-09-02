import type { Decision, ExecutionContext, ExecutionResult, WatcherState } from '../types.js'
import { getSharedFourierClient, depositUSDFC, type FourierSynapseClient } from './synapse.js'

export interface ExecuteOptions {
  /** Pre-built Synapse client (dependency injection for tests). */
  synapseClient?: FourierSynapseClient | null
}

export function calculateProjectedRunway(state: WatcherState, decision: Decision): number | null {
  if (decision.action !== 'TOP_UP') return state.runwayDays
  const spendRate = state.spendRateUSDFCPerDay && state.spendRateUSDFCPerDay > 0 ? state.spendRateUSDFCPerDay : 0.25
  const newAvailable = state.availableUSDFC + decision.amountUSDFC
  return Number((newAvailable / spendRate).toFixed(1))
}

export function describePlannedAction(decision: Decision): string {
  if (decision.action === 'TOP_UP') return `Would deposit ${decision.amountUSDFC.toFixed(2)} USDFC.`
  if (decision.action === 'TRIAGE') return `Would request approval to triage datasets: ${decision.rankedDatasetIds.join(', ')}.`
  if (decision.action === 'WARN') return `Dispatched warning alert: ${decision.reasoning}.`
  return `No onchain action planned (${decision.action}).`
}

export async function execute(
  decision: Decision,
  context: ExecutionContext,
  state?: WatcherState,
  options?: ExecuteOptions
): Promise<ExecutionResult> {
  // SAFETY INVARIANT: Simulation mode NEVER touches wallet or transmits transactions
  if (context.mode === 'simulate') {
    const projected = state ? calculateProjectedRunway(state, decision) : null
    return {
      status: 'simulated',
      summary: describePlannedAction(decision),
      transactionId: null,
      estimatedNewRunwayDays: projected
    }
  }

  if (decision.action === 'HOLD' || decision.action === 'WARN') {
    return {
      status: 'skipped',
      summary: `No onchain action taken (${decision.action}).`,
      transactionId: null
    }
  }

  if (decision.action === 'TOP_UP') {
    // Live execution: real Filecoin Pay deposit via the Synapse SDK.
    // Never fabricates a transaction hash — failure is reported honestly.
    const client = options?.synapseClient !== undefined
      ? options.synapseClient
      : getSharedFourierClient({ network: 'calibration' })

    if (!client) {
      return {
        status: 'failed',
        summary: 'Live top-up unavailable: no wallet configured. Set FOURIER_WALLET_PRIVATE_KEY (or a wallet address for read-only).',
        transactionId: null
      }
    }

    try {
      const txHash = await depositUSDFC(client, decision.amountUSDFC)
      return {
        status: 'executed',
        summary: `Deposited ${decision.amountUSDFC.toFixed(2)} USDFC to Filecoin Pay contract.`,
        transactionId: txHash
      }
    } catch (err) {
      return {
        status: 'failed',
        summary: `Top-up execution failed: ${err instanceof Error ? err.message : String(err)}`,
        transactionId: null
      }
    }
  }

  return {
    status: 'unsupported',
    summary: 'Live execution for this action is gated.',
    transactionId: null
  }
}
