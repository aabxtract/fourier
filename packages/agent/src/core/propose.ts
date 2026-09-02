import type { CompiledPolicy, Provider, WatcherState } from '../types.js'
import { deriveBurnRate } from './history.js'
import type { HistoryPoint } from '../types.js'

/**
 * Deterministic stand-in for the AI provider. Returns the RAW JSON string a
 * model would return — which is then hashed and validated like untrusted
 * output. Real adapters replace this; the pipeline downstream never changes.
 */
export function proposeFromScenario(
  state: WatcherState,
  history: HistoryPoint[],
  provider: Provider
): string {
  const burnRate = deriveBurnRate(history)

  if (state.runwayDays <= 2 && state.availableUSDFC < 1) {
    const ranked = [...state.datasets]
      .sort((a, b) => a.pieceCount - b.pieceCount)
      .map(d => d.id)
    return JSON.stringify({
      action: 'TRIAGE',
      rankedDatasetIds: ranked.slice(0, 2),
      reasoning: `${provider}: runway ${state.runwayDays}d with ${state.availableUSDFC} USDFC; triage lowest-value datasets first.`
    })
  }

  if (burnRate !== null && burnRate > 0) {
    const projected = state.availableUSDFC / burnRate
    if (projected < state.runwayDays) {
      return JSON.stringify({
        action: 'TOP_UP',
        amountUSDFC: 7.5,
        reasoning: `${provider}: burn ${burnRate.toFixed(2)}/day projects ${projected.toFixed(1)}d, under the naive ${state.runwayDays}d; bounded refill recommended.`
      })
    }
  }

  return JSON.stringify({
    action: 'HOLD',
    reasoning: `${provider}: runway healthy at ${state.runwayDays}d.`
  })
}
