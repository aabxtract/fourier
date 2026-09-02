import { Synapse } from '@filoz/synapse-sdk'
import { calibration, mainnet } from '@filoz/synapse-core/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { http, formatUnits, parseUnits, type Address, type Account } from 'viem'
import { loadEnvSecrets } from './config.js'
import type { WatcherState } from '../types.js'

/** Filecoin chain epoch duration. */
export const FILECOIN_EPOCH_SECONDS = 30
export const USDFC_DECIMALS = 18
/** Capped runway reported when no spend rate is locked (effectively unlimited). */
export const MAX_RUNWAY_DAYS = 9999

export interface FourierSynapseClient {
  synapse: Synapse
  walletAddress: string
  /** True when the client holds a signing account (private key), false for read-only. */
  canSign: boolean
}

export interface SynapseClientOptions {
  network: 'calibration' | 'mainnet'
  walletPrivateKey?: string
  walletAddress?: string
  rpcUrl?: string
}

function normalizePrivateKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
}

/**
 * Construct a Synapse SDK client for the configured network.
 * - With FOURIER_WALLET_PRIVATE_KEY: full signing client (read + write).
 * - With only a wallet address: read-only client (no signer is ever constructed).
 * - With neither: returns null; callers fall back to the demo fixture.
 */
export function createFourierClient(options: SynapseClientOptions): FourierSynapseClient | null {
  const privateKey = options.walletPrivateKey?.trim()
  const address = options.walletAddress?.trim()

  if (!privateKey && !address) return null

  const chain = options.network === 'mainnet' ? mainnet : calibration
  const account: Account | Address = privateKey
    ? privateKeyToAccount(normalizePrivateKey(privateKey))
    : (address as Address)

  const synapse = Synapse.create({
    chain,
    account,
    ...(options.rpcUrl ? { transport: http(options.rpcUrl) } : {}),
    source: 'fourier'
  })

  return {
    synapse,
    walletAddress: privateKey ? privateKeyToAccount(normalizePrivateKey(privateKey)).address : (address as string),
    canSign: Boolean(privateKey)
  }
}

/**
 * Shared live client, cached per config fingerprint so the loop, watcher,
 * executor, and delegation paths reuse one instance per process.
 */
let sharedClient: { key: string; client: FourierSynapseClient } | null = null

export function getSharedFourierClient(options: {
  network: 'calibration' | 'mainnet'
  walletAddress?: string
}): FourierSynapseClient | null {
  const secrets = loadEnvSecrets()
  const key = [
    options.network,
    secrets.rpcUrl ?? '',
    secrets.walletPrivateKey ?? '',
    options.walletAddress ?? ''
  ].join('|')

  if (sharedClient && sharedClient.key === key) return sharedClient.client

  const client = createFourierClient({
    network: options.network,
    walletPrivateKey: secrets.walletPrivateKey,
    walletAddress: options.walletAddress,
    rpcUrl: secrets.rpcUrl
  })

  sharedClient = client ? { key, client } : null
  return client
}

/** Reset the shared client cache (used by tests). */
export function resetSharedClient(): void {
  sharedClient = null
}

/** Convert a raw bigint USDFC amount (18 decimals) to a display number. */
export function toUSDFC(raw: bigint): number {
  return Number(Number(formatUnits(raw, USDFC_DECIMALS)).toFixed(4))
}

/** Convert a USDFC float amount to raw bigint units with bounded precision. */
export function fromUSDFC(amountUSDFC: number): bigint {
  return parseUnits(amountUSDFC.toFixed(6), USDFC_DECIMALS)
}

/** Convert runway epochs to days (30s epochs). */
export function epochsToDays(epochs: bigint): number {
  return Number(((Number(epochs) * FILECOIN_EPOCH_SECONDS) / 86400).toFixed(2))
}

/**
 * Read live Filecoin Onchain Cloud account state through the Synapse SDK.
 * Account summary comes from the payments contract; dataset listing failures
 * degrade to an empty list rather than failing the whole observation.
 */
export async function readWatcherState(client: FourierSynapseClient): Promise<WatcherState> {
  const summary = await client.synapse.payments.accountSummary()

  const ratePerEpoch = summary.lockupRatePerEpoch
  const ratePerDayRaw = ratePerEpoch * BigInt(86400 / FILECOIN_EPOCH_SECONDS)
  const spendRateUSDFCPerDay = ratePerEpoch > 0n
    ? Number(formatUnits(ratePerDayRaw, USDFC_DECIMALS))
    : null

  let datasets: WatcherState['datasets'] = []
  try {
    const dataSets = await client.synapse.storage.findDataSets()
    datasets = dataSets.map(ds => ({
      id: ds.dataSetId.toString(),
      status: ds.isLive ? 'active' : 'terminated',
      pieceCount: 0
    }))
  } catch {
    datasets = []
  }

  return {
    observedAt: new Date().toISOString(),
    runwayDays: ratePerEpoch > 0n
      ? Math.min(MAX_RUNWAY_DAYS, epochsToDays(summary.runwayInEpochs))
      : MAX_RUNWAY_DAYS,
    availableUSDFC: toUSDFC(summary.availableFunds),
    lockedUSDFC: toUSDFC(summary.totalLockup),
    spendRateUSDFCPerDay,
    datasets,
    source: 'live',
    walletAddress: client.walletAddress
  }
}

/**
 * Deposit USDFC into the Filecoin Pay contract. When `to` is provided the
 * funds are credited to that recipient (treasury -> child transfer).
 * Returns the onchain transaction hash.
 */
export async function depositUSDFC(
  client: FourierSynapseClient,
  amountUSDFC: number,
  to?: string
): Promise<string> {
  if (!client.canSign) {
    throw new Error(
      'Read-only Synapse client: set FOURIER_WALLET_PRIVATE_KEY to execute onchain transactions.'
    )
  }
  const amount = fromUSDFC(amountUSDFC)
  const hash = to
    ? await client.synapse.payments.deposit({ amount, to: to as Address })
    : await client.synapse.payments.deposit({ amount })
  return hash
}
