import type { Scenario } from '../types.js'

export const scenarios: Record<string, Scenario> = {
  'burn-spike': {
    name: 'burn-spike',
    state: {
      observedAt: '2026-08-26T12:00:00.000Z',
      runwayDays: 9.8,
      availableUSDFC: 12.4,
      lockedUSDFC: 3.1,
      spendRateUSDFCPerDay: 5.9,
      datasets: [{ id: 'customer-ledger', status: 'active', pieceCount: 1200 }],
      source: 'scenario'
    },
    history: [
      { observedAt: '2026-08-25T12:00:00.000Z', availableUSDFC: 15.36 },
      { observedAt: '2026-08-26T06:00:00.000Z', availableUSDFC: 13.88 },
      { observedAt: '2026-08-26T12:00:00.000Z', availableUSDFC: 12.4 }
    ],
    expected: 'Naive projection 9.8 days; history-aware projection 2.1 days.'
  },
  'budget-squeeze': {
    name: 'budget-squeeze',
    state: {
      observedAt: '2026-08-26T12:00:00.000Z',
      runwayDays: 1.2,
      availableUSDFC: 0.7,
      lockedUSDFC: 8.4,
      spendRateUSDFCPerDay: 3.8,
      datasets: [
        { id: 'customer-ledger', status: 'active', pieceCount: 1200 },
        { id: 'audit-archive', status: 'active', pieceCount: 800 },
        { id: 'build-cache', status: 'active', pieceCount: 500 }
      ],
      source: 'scenario'
    },
    history: [],
    expected: 'Rank lower-priority datasets and require approval before TRIAGE.'
  }
}
