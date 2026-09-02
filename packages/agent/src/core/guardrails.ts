import type { CompiledPolicy, Decision, WatcherState } from '../types.js'

export type GuardrailResult =
  | { status: 'allow'; decision: Decision; clamped: boolean }
  | { status: 'hold'; decision: Decision; reason: string }
  | { status: 'approval_required'; decision: Decision; reason: string }

export function enforceGuardrails(decision: Decision, state: WatcherState, policy: CompiledPolicy): GuardrailResult {
  if (decision.action === 'TOP_UP') {
    if (!policy.topUpEnabled) return { status: 'hold', decision: { action: 'HOLD', reasoning: 'TOP_UP is disabled by policy.' }, reason: 'top-up-disabled' }
    const amount = Math.min(decision.amountUSDFC, policy.maxAutoTopUpUSDFC)
    if (!Number.isFinite(amount) || amount <= 0) return { status: 'hold', decision: { action: 'HOLD', reasoning: 'TOP_UP amount is invalid.' }, reason: 'invalid-amount' }
    return { status: 'allow', decision: { ...decision, amountUSDFC: amount }, clamped: amount !== decision.amountUSDFC }
  }
  if (decision.action === 'TRIAGE') {
    if (!policy.triageEnabled) return { status: 'hold', decision: { action: 'HOLD', reasoning: 'TRIAGE is disabled by policy.' }, reason: 'triage-disabled' }
    if (policy.triageRequiresApproval) return { status: 'approval_required', decision, reason: 'telegram-approval-required' }
  }
  return { status: 'allow', decision, clamped: false }
}
