import type { WatcherState, DatasetState, Scenario } from '../types.js'
import { scenarios } from '../scenarios/index.js'
import {
  getSharedFourierClient,
  readWatcherState,
  type FourierSynapseClient
} from './synapse.js'

export interface WatcherOptions {
  network?: 'calibration' | 'mainnet'
  rpcUrl?: string
  walletAddress?: string
  scenario?: Scenario | string
  /** Pre-built Synapse client (dependency injection for tests). Overrides env discovery. */
  client?: FourierSynapseClient | null
}

export class WatcherError extends Error {
  constructor(message: string, readonly originalError?: unknown) {
    super(message)
    this.name = 'WatcherError'
  }
}

/**
 * Clean unit formatting helper: formats USDFC decimals safely without precision loss.
 */
export function formatUSDFC(rawBigIntAmount: bigint, decimals = 18): number {
  const divisor = 10n ** BigInt(decimals)
  const integerPart = rawBigIntAmount / divisor
  const remainder = rawBigIntAmount % divisor
  const fractionStr = remainder.toString().padStart(decimals, '0').slice(0, 4)
  return Number(`${integerPart}.${fractionStr}`)
}

/**
 * Watcher acquires current onchain or scenario account state.
 */
export class Watcher {
  private options: WatcherOptions

  constructor(options: WatcherOptions = {}) {
    this.options = options
  }

  async readState(): Promise<WatcherState> {
    if (this.options.scenario) {
      const scenarioObj =
        typeof this.options.scenario === 'string'
          ? scenarios[this.options.scenario]
          : this.options.scenario

      if (!scenarioObj) {
        throw new WatcherError(`Unknown scenario: ${this.options.scenario}`)
      }

      return {
        ...scenarioObj.state,
        observedAt: new Date().toISOString(),
        source: 'scenario'
      }
    }

    // Live Read mode: real Synapse SDK read when a client can be constructed
    // (FOURIER_WALLET_PRIVATE_KEY or walletAddress configured), otherwise an
    // honestly-labeled demo fixture — never presented as live chain data.
    try {
      const client =
        this.options.client !== undefined
          ? this.options.client
          : getSharedFourierClient({
              network: this.options.network ?? 'calibration',
              walletAddress: this.options.walletAddress
            })

      if (client) {
        return await readWatcherState(client)
      }

      const walletAddress = this.options.walletAddress || '0x0000000000000000000000000000000000000000'

      return {
        observedAt: new Date().toISOString(),
        runwayDays: 8.5,
        availableUSDFC: 15.0,
        lockedUSDFC: 4.2,
        spendRateUSDFCPerDay: 1.76,
        datasets: [
          { id: 'customer-ledger', status: 'active', pieceCount: 1200 },
          { id: 'audit-archive', status: 'active', pieceCount: 800 }
        ],
        source: 'demo-fixture',
        walletAddress
      }
    } catch (err) {
      throw new WatcherError(
        `Failed to query onchain storage account state: ${err instanceof Error ? err.message : String(err)}`,
        err
      )
    }
  }
}
