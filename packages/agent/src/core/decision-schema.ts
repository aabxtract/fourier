import type { Decision, WatcherState } from '../types.js'

const validReasoning = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000

export function parseDecision(raw: string, state: WatcherState): Decision {
  try {
    const parsed: unknown = JSON.parse(raw.replace(/```json|```/g, '').trim())
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    const value = parsed as Record<string, unknown>
    if (!validReasoning(value.reasoning) || typeof value.action !== 'string') throw new Error('invalid common fields')

    if (value.action === 'HOLD' || value.action === 'WARN') return { action: value.action, reasoning: value.reasoning }
    if (value.action === 'TOP_UP') {
      if (typeof value.amountUSDFC !== 'number' || !Number.isFinite(value.amountUSDFC) || value.amountUSDFC <= 0) throw new Error('invalid amount')
      return { action: 'TOP_UP', amountUSDFC: value.amountUSDFC, reasoning: value.reasoning }
    }
    if (value.action === 'TRIAGE') {
      if (!Array.isArray(value.rankedDatasetIds) || value.rankedDatasetIds.length === 0 || value.rankedDatasetIds.some(id => typeof id !== 'string' || !state.datasets.some(dataset => dataset.id === id))) throw new Error('invalid datasets')
      return { action: 'TRIAGE', rankedDatasetIds: value.rankedDatasetIds, reasoning: value.reasoning }
    }
    throw new Error('unknown action')
  } catch {
    return { action: 'HOLD', reasoning: 'Model output failed decision validation.' }
  }
}
