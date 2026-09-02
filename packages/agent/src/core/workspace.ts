import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AgentMemoryRecord } from '../types.js'

export interface WorkspaceContext {
  soul: string
  memory: string
  tools: string
  user: string
}

const WORKSPACE_DIR = 'workspace'

function workspacePath(filename: string): string {
  return resolve(process.cwd(), WORKSPACE_DIR, filename)
}

function ensureWorkspaceDir(): void {
  const dir = resolve(process.cwd(), WORKSPACE_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readFileOrDefault(filepath: string, fallback: string): string {
  if (!existsSync(filepath)) return fallback
  return readFileSync(filepath, 'utf8')
}

/**
 * Load all four workspace files and return their contents as a WorkspaceContext.
 * If any file is missing, returns a sensible default.
 */
export function loadWorkspaceFiles(): WorkspaceContext {
  return {
    soul: readFileOrDefault(
      workspacePath('SOUL.md'),
      'You are Fourier, an autonomous Filecoin storage budget manager. You are precise, conservative with money, and always explain your reasoning in plain English.'
    ),
    memory: readFileOrDefault(
      workspacePath('MEMORY.md'),
      '# Decision Memory\n\nNo previous decisions recorded.'
    ),
    tools: readFileOrDefault(
      workspacePath('TOOLS.md'),
      '# Available Actions\n\nHOLD, WARN, TOP_UP, TRIAGE'
    ),
    user: readFileOrDefault(
      workspacePath('USER.md'),
      '# User Preferences\n\nNo custom rules configured.'
    )
  }
}

/**
 * Rewrite MEMORY.md with the latest 10 memory records.
 * Called after every agent cycle to keep the workspace file in sync.
 */
export function updateMemoryMd(records: AgentMemoryRecord[]): void {
  ensureWorkspaceDir()

  const latest = records.slice(-10)
  const lines: string[] = [
    '# Fourier — Decision Memory',
    '',
    '> This file is automatically updated after every agent cycle.',
    '> It contains the last 10 decisions and their outcomes.',
    '> Do not edit manually — it will be overwritten.',
    '',
    '## Recent Decisions',
    ''
  ]

  if (latest.length === 0) {
    lines.push('_No decisions recorded yet. Memory will populate after the first agent cycle._')
  } else {
    for (const r of latest) {
      const dateStr = r.created_at.slice(0, 16).replace('T', ' ')
      const topupStr = r.amount_if_topup ? ` (${r.amount_if_topup} USDFC)` : ''
      const outcomeStr = r.outcome || 'PENDING EVALUATION'
      lines.push(`- **[${dateStr}]** ${r.action}${topupStr} at ${r.runway_days_at_decision.toFixed(1)}d runway → ${outcomeStr}`)
    }
  }

  writeFileSync(workspacePath('MEMORY.md'), lines.join('\n') + '\n')
}

/**
 * Append a new user preference or rule to USER.md.
 * Called when the user sends a new instruction via Telegram or Discord.
 */
export function updateUserMd(newRule: string, source: 'telegram' | 'discord' | 'manual' = 'manual'): void {
  ensureWorkspaceDir()
  const filepath = workspacePath('USER.md')
  const existing = readFileOrDefault(filepath, '')

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const ruleEntry = `- **[${timestamp}]** _(via ${source})_ ${newRule}`

  // If file has the placeholder text, replace it
  if (existing.includes('No custom rules configured yet')) {
    const updated = existing.replace(
      '_No custom rules configured yet. Send a message like "never let my runway drop below 10 days" to add one._',
      ruleEntry
    )
    writeFileSync(filepath, updated)
  } else {
    // Append after the "## Active Rules" section
    const marker = '## Active Rules'
    const idx = existing.indexOf(marker)
    if (idx !== -1) {
      const insertPos = existing.indexOf('\n', idx + marker.length)
      const updated = existing.slice(0, insertPos + 1) + '\n' + ruleEntry + '\n' + existing.slice(insertPos + 1)
      writeFileSync(filepath, updated)
    } else {
      // Fallback: append to end
      writeFileSync(filepath, existing + '\n' + ruleEntry + '\n')
    }
  }
}

/**
 * Build the full workspace-enhanced system prompt for the Brain.
 */
export function buildWorkspaceSystemPrompt(workspace: WorkspaceContext, policyJson: string, memoryPromptBlock: string): string {
  return [
    '### AGENT IDENTITY (SOUL)',
    workspace.soul,
    '',
    '### AVAILABLE ACTIONS (TOOLS)',
    workspace.tools,
    '',
    '### USER PREFERENCES',
    workspace.user,
    '',
    '### COMPILED POLICY',
    policyJson,
    '',
    '### DECISION MEMORY',
    workspace.memory,
    '',
    memoryPromptBlock,
    '',
    '### LEARNING DIRECTIVE',
    'Review your previous decisions and their outcomes above. If past decisions (such as waiting to top up at 3 days) repeatedly produced poor outcomes or failure states under accelerating burn rates, adapt your strategy by acting earlier or adjusting top-up amounts within policy bounds.'
  ].join('\n')
}

/**
 * Build the conversational system prompt for user chat messages.
 * This is different from the decision prompt — it enables freeform conversation.
 */
export function buildConversationSystemPrompt(workspace: WorkspaceContext, currentStateBlock: string): string {
  return [
    '### AGENT IDENTITY',
    workspace.soul,
    '',
    '### YOUR TOOLS & CAPABILITIES',
    workspace.tools,
    '',
    '### USER PREFERENCES',
    workspace.user,
    '',
    '### RECENT DECISION HISTORY',
    workspace.memory,
    '',
    '### CURRENT ONCHAIN STATE',
    currentStateBlock,
    '',
    '### CONVERSATION RULES',
    '- You are having a natural conversation with the user who owns this storage account.',
    '- Answer questions about state, runway, balance, and decisions in plain English.',
    '- If the user gives you a new rule or preference (e.g. "never let runway drop below 10 days"), acknowledge it and confirm you will follow it.',
    '- If the user asks about past decisions, summarise from your decision memory.',
    '- If the user asks you to simulate something, describe what would happen based on current state and policy.',
    '- Be concise, helpful, and proactive. If you notice something worth flagging, mention it.',
    '- Do NOT return JSON. Respond in natural language.'
  ].join('\n')
}
