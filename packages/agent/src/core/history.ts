import type { HistoryPoint, WatcherState } from '../types.js'

export const MIN_SAMPLES_FOR_BURN_RATE = 2

/**
 * Derive the most recent spend rate from the latest pair of observations.
 * Using the most recent segment (not the whole window) is what lets an
 * accelerating burn show up as a shorter history-aware runway — the core of
 * the burn-spike demo. Returns null until enough samples exist.
 */
export function deriveBurnRate(history: HistoryPoint[]): number | null {
  if (history.length < MIN_SAMPLES_FOR_BURN_RATE) return null

  const sorted = [...history].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime()
  )
  const prev = sorted[sorted.length - 2]
  const last = sorted[sorted.length - 1]

  const elapsedMs = new Date(last.observedAt).getTime() - new Date(prev.observedAt).getTime()
  if (elapsedMs <= 0) return null

  const spent = prev.availableUSDFC - last.availableUSDFC
  if (spent <= 0) return 0

  const elapsedDays = elapsedMs / 86_400_000
  return spent / elapsedDays
}

/** History-aware projection: available funds ÷ observed burn rate. */
export function projectRunwayDays(state: WatcherState, history: HistoryPoint[]): number | null {
  const rate = deriveBurnRate(history)
  if (rate === null || rate <= 0) return null
  return state.availableUSDFC / rate
}

/** Point-in-time (naive) projection used as the contrast in the demo. */
export function naiveRunwayDays(state: WatcherState): number {
  return state.runwayDays
}
