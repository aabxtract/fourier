import type { CompiledPolicy } from '../types.js'

const matchNumber = (text: string, pattern: RegExp, fallback: number): number => {
  const match = text.match(pattern)
  return match ? Number(match[1]) : fallback
}

export function compilePolicy(text: string): CompiledPolicy {
  const warningRunwayDays = matchNumber(
    text,
    /warn[^.\n]*?(?:below|under)\s+(\d+(?:\.\d+)?)\s+days?/i,
    7
  )
  const actionRunwayDays = matchNumber(
    text,
    /(?:below|under)\s+(\d+(?:\.\d+)?)\s+days?[^.\n]*?top up/i,
    3
  )
  const maxAutoTopUpUSDFC = matchNumber(
    text,
    /(?:at most|max(?:imum)?)[^\d]*(\d+(?:\.\d+)?)\s*USDFC/i,
    5
  )
  const priorityLine = text.match(/preserve\s+(.+?)(?:\.|\n|$)/i)?.[1]
  const datasetPriority = priorityLine
    ? priorityLine
        .split(/,|\s+and\s+|\s+before\s+/i)
        .map(value => value.trim())
        .filter(Boolean)
    : []

  if (
    !Number.isFinite(warningRunwayDays) ||
    !Number.isFinite(actionRunwayDays) ||
    !Number.isFinite(maxAutoTopUpUSDFC) ||
    warningRunwayDays <= 0 ||
    actionRunwayDays <= 0 ||
    maxAutoTopUpUSDFC <= 0 ||
    actionRunwayDays >= warningRunwayDays
  ) {
    throw new Error('Policy requires positive limits and action runway below warning runway.')
  }

  return {
    version: 1,
    warningRunwayDays,
    actionRunwayDays,
    maxAutoTopUpUSDFC,
    datasetPriority,
    topUpEnabled: /top up/i.test(text),
    triageEnabled: /triage|terminate|preserve/i.test(text),
    triageRequiresApproval: /approval|approve|without my approval/i.test(text)
  }
}
