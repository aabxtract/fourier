# Fourier — Build Guide
**Filecoin TLDR Builder Challenge Cycle 4**
**Timeline: 2 weeks | Solo**

---

## What You're Building

An autonomous storage budget manager for Filecoin Onchain Cloud. Fourier watches your FOC runway onchain, reasons about it using any AI model you plug in, and acts — without you doing anything.

```bash
npx fourier init
npx fourier start
```

---

## Repo Structure

```
fourier/
├── packages/
│   ├── agent/                     ← core agent (published to npm as `fourier`)
│   │   ├── src/
│   │   │   ├── index.ts           ← entry point
│   │   │   ├── cli/
│   │   │   │   ├── init.ts        ← npx fourier init (guided setup)
│   │   │   │   └── start.ts       ← npx fourier start
│   │   │   ├── core/
│   │   │   │   ├── watcher.ts     ← runway polling loop
│   │   │   │   ├── brain.ts       ← model-agnostic AI reasoning layer
│   │   │   │   ├── executor.ts    ← onchain execution via Synapse SDK
│   │   │   │   └── logger.ts      ← Supabase event push
│   │   │   ├── models/
│   │   │   │   ├── claude.ts      ← Anthropic adapter
│   │   │   │   ├── openai.ts      ← OpenAI adapter
│   │   │   │   ├── grok.ts        ← xAI adapter
│   │   │   │   └── gemini.ts      ← Google adapter
│   │   │   └── notifications/
│   │   │       ├── telegram.ts
│   │   │       └── discord.ts
│   │   ├── fourier.config.example.json
│   │   └── package.json
│   └── dashboard/                 ← Next.js 16 frontend
│       ├── app/
│       │   ├── page.tsx           ← landing page
│       │   ├── dashboard/
│       │   │   └── page.tsx       ← live agent dashboard
│       │   └── setup/
│       │       └── page.tsx       ← web config panel
│       └── package.json
```

---

## Day-by-Day Build Plan

---

### Day 1 — Project Scaffolding + Config

**Goal:** Monorepo boots, `npx fourier init` runs and saves config.

Init monorepo:
```bash
mkdir fourier && cd fourier
npm init -y
mkdir -p packages/agent/src packages/dashboard
```

Root `package.json`:
```json
{
  "name": "fourier",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "agent": "npm run dev --workspace=packages/agent",
    "dashboard": "npm run dev --workspace=packages/dashboard"
  }
}
```

`packages/agent/package.json`:
```json
{
  "name": "fourier",
  "version": "0.1.0",
  "description": "Autonomous storage budget manager for Filecoin Onchain Cloud",
  "bin": { "fourier": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "@filoz/synapse-sdk": "^0.41.0",
    "@anthropic-ai/sdk": "^0.24.0",
    "openai": "^4.52.0",
    "@google/generative-ai": "^0.15.0",
    "viem": "^2.16.0",
    "@supabase/supabase-js": "^2.44.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.1",
    "prompts": "^2.4.2",
    "dotenv": "^16.4.5",
    "node-cron": "^3.0.3",
    "node-fetch": "^3.3.2"
  }
}
```

`fourier.config.example.json`:
```json
{
  "agentId": "fourier-abc123",
  "network": "calibration",
  "wallet": {
    "privateKey": "0x..."
  },
  "model": {
    "provider": "claude",
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-6"
  },
  "thresholds": {
    "warningRunwayDays": 7,
    "actionRunwayDays": 3,
    "maxAutoTopUpUSDFC": 5
  },
  "notifications": {
    "telegram": {
      "botToken": "",
      "chatId": ""
    },
    "discord": {
      "webhookUrl": ""
    },
    "webhook": {
      "url": ""
    }
  },
  "supabase": {
    "url": "",
    "anonKey": ""
  },
  "checkIntervalMinutes": 30
}
```

---

### Day 2 — CLI: `fourier init`

**Goal:** Guided terminal setup that writes `fourier.config.json`.

`packages/agent/src/cli/init.ts`:

```ts
import prompts from 'prompts'
import chalk from 'chalk'
import { writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { randomBytes } from 'crypto'

export async function init() {
  console.log(chalk.cyan('\n🌊 Fourier — Setup\n'))

  const { provider } = await prompts({
    type: 'select',
    name: 'provider',
    message: 'Which AI model should run your agent?',
    choices: [
      { title: 'Claude (Anthropic)', value: 'claude' },
      { title: 'GPT-4o (OpenAI)', value: 'openai' },
      { title: 'Grok (xAI)', value: 'grok' },
      { title: 'Gemini (Google)', value: 'gemini' },
    ]
  })

  const { apiKey } = await prompts({
    type: 'password',
    name: 'apiKey',
    message: `${provider} API key:`
  })

  const modelDefaults: Record<string, string> = {
    claude: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    grok: 'grok-2-latest',
    gemini: 'gemini-1.5-pro'
  }

  const { privateKey } = await prompts({
    type: 'password',
    name: 'privateKey',
    message: 'FOC wallet private key (0x...):'
  })

  const { network } = await prompts({
    type: 'select',
    name: 'network',
    message: 'Network:',
    choices: [
      { title: 'Calibration (testnet)', value: 'calibration' },
      { title: 'Mainnet', value: 'mainnet' }
    ]
  })

  const { warningDays, actionDays, maxTopUp } = await prompts([
    {
      type: 'number',
      name: 'warningDays',
      message: 'Warn me when runway drops below (days):',
      initial: 7
    },
    {
      type: 'number',
      name: 'actionDays',
      message: 'Act automatically when runway drops below (days):',
      initial: 3
    },
    {
      type: 'number',
      name: 'maxTopUp',
      message: 'Max auto top-up amount (USDFC):',
      initial: 5
    }
  ])

  const { telegramToken, telegramChatId } = await prompts([
    {
      type: 'text',
      name: 'telegramToken',
      message: 'Telegram bot token (leave blank to skip):'
    },
    {
      type: (prev: string) => prev ? 'text' : null,
      name: 'telegramChatId',
      message: 'Telegram chat ID:'
    }
  ])

  const { discordWebhook } = await prompts({
    type: 'text',
    name: 'discordWebhook',
    message: 'Discord webhook URL (leave blank to skip):'
  })

  const { webhookUrl } = await prompts({
    type: 'text',
    name: 'webhookUrl',
    message: 'Custom webhook URL (leave blank to skip):'
  })

  const { supabaseUrl, supabaseKey } = await prompts([
    {
      type: 'text',
      name: 'supabaseUrl',
      message: 'Supabase project URL (leave blank to skip cloud dashboard):'
    },
    {
      type: (prev: string) => prev ? 'text' : null,
      name: 'supabaseKey',
      message: 'Supabase anon key:'
    }
  ])

  const config = {
    agentId: `fourier-${randomBytes(4).toString('hex')}`,
    network,
    wallet: { privateKey },
    model: { provider, apiKey, model: modelDefaults[provider] },
    thresholds: {
      warningRunwayDays: warningDays,
      actionRunwayDays: actionDays,
      maxAutoTopUpUSDFC: maxTopUp
    },
    notifications: {
      telegram: telegramToken ? { botToken: telegramToken, chatId: telegramChatId } : null,
      discord: discordWebhook ? { webhookUrl: discordWebhook } : null,
      webhook: webhookUrl ? { url: webhookUrl } : null
    },
    supabase: supabaseUrl ? { url: supabaseUrl, anonKey: supabaseKey } : null,
    checkIntervalMinutes: 30
  }

  const configPath = resolve(process.cwd(), 'fourier.config.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  console.log(chalk.green('\n✅ Config saved to fourier.config.json\n'))
  console.log('Run ' + chalk.cyan('npx fourier start') + ' to start your agent.\n')

  if (supabaseUrl) {
    console.log('Dashboard will be live at your deployed Fourier frontend.')
    console.log('Agent ID: ' + chalk.cyan(config.agentId) + '\n')
  }
}
```

**Pre-commit guard** — add to `.git/hooks/pre-commit`:
```bash
#!/bin/sh
if git diff --cached | grep -qE '0x[0-9a-fA-F]{64}'; then
  echo "ERROR: Possible private key detected in staged files. Aborting commit."
  exit 1
fi
```

---

### Day 3 — Synapse Watcher

**Goal:** Agent reads runway and balance onchain every N minutes.

`packages/agent/src/core/watcher.ts`:

```ts
import { Synapse } from '@filoz/synapse-sdk'
import { privateKeyToAccount } from 'viem/accounts'
import type { FourierConfig } from '../types'

export interface WatcherState {
  runwayInEpochs: number
  runwayInDays: number
  usdfc: number
  lockedUSDFC: number
  datasets: Dataset[]
  providersAvailable: number
}

export interface Dataset {
  id: string
  status: string
  pieceCount: number
  providerId: string
}

const EPOCHS_PER_DAY = 2880 // 30s per epoch, 2880 epochs per day

export async function readState(config: FourierConfig): Promise<WatcherState> {
  const account = privateKeyToAccount(config.wallet.privateKey as `0x${string}`)
  const synapse = new Synapse({ account, network: config.network, source: 'fourier' })

  const summary = await synapse.payments.getAccountSummary()
  const providers = await synapse.storage.getProviders()

  // Fetch datasets — adjust method name based on actual SDK exports
  let datasets: Dataset[] = []
  try {
    const rawDatasets = await synapse.storage.listDatasets()
    datasets = rawDatasets.map((d: any) => ({
      id: d.datasetId,
      status: d.status,
      pieceCount: d.pieceCount,
      providerId: d.providerId
    }))
  } catch (_) {
    // listDatasets may not exist yet — skip gracefully
  }

  const runwayInEpochs = Number(summary.runwayInEpochs || 0)

  return {
    runwayInEpochs,
    runwayInDays: Math.floor(runwayInEpochs / EPOCHS_PER_DAY),
    usdfc: Number(summary.balance) / 1e18,
    lockedUSDFC: Number(summary.lockedBalance) / 1e18,
    datasets,
    providersAvailable: providers.length
  }
}
```

---

### Day 4 — Model-Agnostic Brain

**Goal:** Any AI model receives the financial state and returns a structured decision.

`packages/agent/src/core/brain.ts`:

```ts
import type { WatcherState } from './watcher'
import type { FourierConfig } from '../types'
import { callClaude } from '../models/claude'
import { callOpenAI } from '../models/openai'
import { callGrok } from '../models/grok'
import { callGemini } from '../models/gemini'

export type Decision =
  | { action: 'HOLD'; reasoning: string }
  | { action: 'TOP_UP'; amount: number; reasoning: string }
  | { action: 'TRIAGE'; datasetId: string; reasoning: string }
  | { action: 'WARN'; reasoning: string }

export async function decide(
  state: WatcherState,
  config: FourierConfig
): Promise<Decision> {
  const prompt = buildPrompt(state, config)

  let raw: string
  switch (config.model.provider) {
    case 'claude':  raw = await callClaude(prompt, config.model); break
    case 'openai':  raw = await callOpenAI(prompt, config.model); break
    case 'grok':    raw = await callGrok(prompt, config.model); break
    case 'gemini':  raw = await callGemini(prompt, config.model); break
    default: throw new Error(`Unknown provider: ${config.model.provider}`)
  }

  return parseDecision(raw)
}

function buildPrompt(state: WatcherState, config: FourierConfig): string {
  return `You are Fourier, an autonomous Filecoin storage budget manager.

CURRENT STATE:
- Runway: ${state.runwayInDays} days (${state.runwayInEpochs} epochs)
- USDFC balance: ${state.usdfc.toFixed(4)} USDFC
- Locked USDFC: ${state.lockedUSDFC.toFixed(4)} USDFC
- Active datasets: ${state.datasets.length}
- Available providers: ${state.providersAvailable}

USER RULES:
- Warn when runway < ${config.thresholds.warningRunwayDays} days
- Act when runway < ${config.thresholds.actionRunwayDays} days
- Max auto top-up: ${config.thresholds.maxAutoTopUpUSDFC} USDFC

DATASETS:
${state.datasets.map(d => `- ${d.id}: ${d.status}, ${d.pieceCount} pieces`).join('\n') || 'None'}

Decide what to do. Respond ONLY with valid JSON matching one of these shapes:
{ "action": "HOLD", "reasoning": "..." }
{ "action": "WARN", "reasoning": "..." }
{ "action": "TOP_UP", "amount": <number>, "reasoning": "..." }
{ "action": "TRIAGE", "datasetId": "<id>", "reasoning": "..." }

Rules:
- TOP_UP amount must not exceed ${config.thresholds.maxAutoTopUpUSDFC}
- Only TRIAGE if runway is critically low and TOP_UP is not possible
- Be concise in reasoning (1-2 sentences max)
- Respond with JSON only, no markdown, no preamble`
}

function parseDecision(raw: string): Decision {
  try {
    const clean = raw.replace(/```json|```/g, '').trim()
    return JSON.parse(clean) as Decision
  } catch {
    return { action: 'HOLD', reasoning: 'Could not parse model response — holding.' }
  }
}
```

`packages/agent/src/models/claude.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk'

export async function callClaude(prompt: string, model: { apiKey: string; model: string }) {
  const client = new Anthropic({ apiKey: model.apiKey })
  const res = await client.messages.create({
    model: model.model,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }]
  })
  return (res.content[0] as { text: string }).text
}
```

OpenAI, Grok, and Gemini adapters follow the same pattern — initialize client with `model.apiKey`, call chat completion, return the text content.

---

### Day 5 — Executor

**Goal:** Takes the brain's decision and executes it onchain.

`packages/agent/src/core/executor.ts`:

```ts
import { Synapse } from '@filoz/synapse-sdk'
import { privateKeyToAccount } from 'viem/accounts'
import { parseUnits } from 'viem'
import type { Decision } from './brain'
import type { FourierConfig } from '../types'

export async function execute(decision: Decision, config: FourierConfig): Promise<string> {
  if (decision.action === 'HOLD' || decision.action === 'WARN') {
    return `No onchain action taken. (${decision.action})`
  }

  const account = privateKeyToAccount(config.wallet.privateKey as `0x${string}`)
  const synapse = new Synapse({ account, network: config.network, source: 'fourier' })

  if (decision.action === 'TOP_UP') {
    const amount = parseUnits(decision.amount.toString(), 18)
    await synapse.payments.deposit({ amount })
    return `Deposited ${decision.amount} USDFC`
  }

  if (decision.action === 'TRIAGE') {
    // Terminate dataset — adjust method based on actual SDK
    await synapse.storage.terminateDataset(decision.datasetId)
    return `Terminated dataset ${decision.datasetId}`
  }

  return 'Unknown action'
}
```

---

### Day 6 — Notifications

**Goal:** Every decision fires to Telegram and/or Discord with plain English.

`packages/agent/src/notifications/telegram.ts`:

```ts
export async function sendTelegram(
  token: string,
  chatId: string,
  message: string
) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
  })
}

export function formatMessage(
  action: string,
  reasoning: string,
  agentId: string,
  model: string,
  runwayDays: number
): string {
  const emoji: Record<string, string> = {
    HOLD: '✅', WARN: '⚠️', TOP_UP: '💰', TRIAGE: '🗂️'
  }
  return `*Fourier* ${emoji[action] || '🤖'}
*Action:* ${action}
*Runway:* ${runwayDays} days
*Reasoning:* ${reasoning}
*Model:* ${model}
*Agent:* \`${agentId}\``
}
```

`packages/agent/src/notifications/discord.ts`:

```ts
export async function sendDiscord(webhookUrl: string, content: string) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  })
}
```

**Webhook:**
```ts
export async function sendWebhook(url: string, payload: object) {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}
```

---

### Day 7 — Supabase Logger + Real-Time Dashboard Setup

**Goal:** Every agent event pushed to Supabase. Frontend reads it live.

**Supabase setup (30 mins):**

Create a project at supabase.com. Run this SQL:

```sql
create table agent_events (
  id uuid default gen_random_uuid() primary key,
  agent_id text not null,
  action text not null,
  reasoning text,
  runway_days integer,
  usdfc_balance numeric,
  model_provider text,
  model_name text,
  executed_result text,
  created_at timestamptz default now()
);

-- Enable real-time
alter publication supabase_realtime add table agent_events;
```

`packages/agent/src/core/logger.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import type { Decision } from './brain'
import type { WatcherState } from './watcher'
import type { FourierConfig } from '../types'

export async function logEvent(
  decision: Decision,
  state: WatcherState,
  executedResult: string,
  config: FourierConfig
) {
  if (!config.supabase) return

  const supabase = createClient(config.supabase.url, config.supabase.anonKey)

  await supabase.from('agent_events').insert({
    agent_id: config.agentId,
    action: decision.action,
    reasoning: decision.reasoning,
    runway_days: state.runwayInDays,
    usdfc_balance: state.usdfc,
    model_provider: config.model.provider,
    model_name: config.model.model,
    executed_result: executedResult
  })
}
```

---

### Day 8 — Main Loop + `fourier start`

**Goal:** Everything wires together. Agent runs autonomously.

`packages/agent/src/cli/start.ts`:

```ts
import chalk from 'chalk'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { readState } from '../core/watcher'
import { decide } from '../core/brain'
import { execute } from '../core/executor'
import { logEvent } from '../core/logger'
import { sendTelegram, formatMessage } from '../notifications/telegram'
import { sendDiscord } from '../notifications/discord'
import { sendWebhook } from '../notifications/webhook'
import type { FourierConfig } from '../types'

export async function start() {
  const configPath = resolve(process.cwd(), 'fourier.config.json')

  if (!existsSync(configPath)) {
    console.log(chalk.red('No fourier.config.json found. Run npx fourier init first.'))
    process.exit(1)
  }

  const config: FourierConfig = JSON.parse(readFileSync(configPath, 'utf8'))

  console.log(chalk.cyan(`\n🌊 Fourier starting — Agent ID: ${config.agentId}`))
  console.log(chalk.gray(`Model: ${config.model.provider} / ${config.model.model}`))
  console.log(chalk.gray(`Network: ${config.network}`))
  console.log(chalk.gray(`Check interval: every ${config.checkIntervalMinutes} minutes\n`))

  const run = async () => {
    console.log(chalk.gray(`[${new Date().toISOString()}] Checking state...`))

    const state = await readState(config)
    console.log(chalk.white(`  Runway: ${state.runwayInDays} days | Balance: ${state.usdfc.toFixed(4)} USDFC`))

    const decision = await decide(state, config)
    console.log(chalk.yellow(`  Decision: ${decision.action} — ${decision.reasoning}`))

    const executedResult = await execute(decision, config)
    if (executedResult) console.log(chalk.green(`  Executed: ${executedResult}`))

    // Notify
    const msg = formatMessage(
      decision.action,
      decision.reasoning,
      config.agentId,
      config.model.model,
      state.runwayInDays
    )

    if (config.notifications.telegram) {
      await sendTelegram(
        config.notifications.telegram.botToken,
        config.notifications.telegram.chatId,
        msg
      )
    }

    if (config.notifications.discord) {
      await sendDiscord(config.notifications.discord.webhookUrl, msg)
    }

    if (config.notifications.webhook) {
      await sendWebhook(config.notifications.webhook.url, {
        agentId: config.agentId,
        action: decision.action,
        reasoning: decision.reasoning,
        runwayDays: state.runwayInDays,
        usdfc: state.usdfc,
        model: config.model.model,
        timestamp: new Date().toISOString()
      })
    }

    await logEvent(decision, state, executedResult, config)
  }

  // Run immediately then on interval
  await run()
  setInterval(run, config.checkIntervalMinutes * 60 * 1000)
}
```

---

### Day 9-10 — Next.js Dashboard

**Goal:** Live dashboard at a hosted URL showing agent state in real time.

Three pages:

**`/` — Landing page**
- What Fourier is, one-command install, link to docs
- Distinctive design: dark background, monospace terminal aesthetic, cyan accent
- CTA: "Get Started" → `/setup`

**`/setup` — Web config panel**
- Form that mirrors `fourier init` questions
- On submit: generates and downloads `fourier.config.json`
- For people who prefer not to use the terminal

**`/dashboard` — Live agent dashboard**
- User enters their Agent ID
- Shows: current runway (days), USDFC balance, active datasets, last action
- Live event feed — Supabase real-time subscription, events appear as they happen
- Each event card: action badge, reasoning, model used, timestamp

Key dashboard component:

```tsx
'use client'
import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export function EventFeed({ agentId }: { agentId: string }) {
  const [events, setEvents] = useState<any[]>([])

  useEffect(() => {
    // Load existing events
    supabase
      .from('agent_events')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setEvents(data || []))

    // Subscribe to new events
    const channel = supabase
      .channel('fourier-events')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'agent_events',
        filter: `agent_id=eq.${agentId}`
      }, (payload) => {
        setEvents(prev => [payload.new, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [agentId])

  return (
    <div className="space-y-3">
      {events.map(event => (
        <div key={event.id} className="border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-mono px-2 py-0.5 rounded ${
              event.action === 'TOP_UP' ? 'bg-green-900 text-green-300' :
              event.action === 'WARN' ? 'bg-yellow-900 text-yellow-300' :
              event.action === 'TRIAGE' ? 'bg-red-900 text-red-300' :
              'bg-zinc-800 text-zinc-400'
            }`}>{event.action}</span>
            <span className="text-xs text-zinc-500">{event.model_provider} / {event.model_name}</span>
            <span className="text-xs text-zinc-600 ml-auto">{new Date(event.created_at).toLocaleString()}</span>
          </div>
          <p className="text-sm text-zinc-300">{event.reasoning}</p>
          <p className="text-xs text-zinc-500 mt-1">
            Runway: {event.runway_days}d · Balance: {Number(event.usdfc_balance).toFixed(4)} USDFC
          </p>
        </div>
      ))}
    </div>
  )
}
```

---

### Day 11 — Natural Language Config via Telegram

**Goal:** User texts the agent rules. Agent parses and updates its config.

Add a Telegram message listener to the agent. When a message arrives from the configured chat ID, pipe it to the AI model with a system prompt that extracts config updates:

```ts
// Telegram polling loop
async function listenTelegram(config: FourierConfig) {
  let offset = 0
  while (true) {
    const res = await fetch(
      `https://api.telegram.org/bot${config.notifications.telegram!.botToken}/getUpdates?offset=${offset}&timeout=30`
    )
    const data = await res.json()

    for (const update of data.result) {
      offset = update.update_id + 1
      const text = update.message?.text
      const chatId = update.message?.chat?.id?.toString()

      if (chatId !== config.notifications.telegram!.chatId) continue

      // Handle natural language rule updates
      const extracted = await extractConfigUpdate(text, config)
      if (extracted) {
        // Merge and save updated config
        Object.assign(config.thresholds, extracted)
        writeFileSync('fourier.config.json', JSON.stringify(config, null, 2))
        await sendTelegram(config.notifications.telegram!.botToken, chatId,
          `✅ Updated: ${JSON.stringify(extracted)}`)
      } else {
        // General question — answer with current state
        await sendTelegram(config.notifications.telegram!.botToken, chatId,
          `Current runway: ${lastState?.runwayInDays} days\nLast action: ${lastDecision?.action}`)
      }
    }
  }
}
```

---

### Day 12 — Polish + README

**Checklist:**
- README explains what Fourier is, one-command install, all config options
- `fourier.config.example.json` has inline comments
- Error messages are human-readable throughout
- Test full flow: `init` → `start` → action fires → Telegram notifies → dashboard updates
- Publish to npm: `npm publish --access public`
- Deploy dashboard to Vercel

---

### Day 13 — Demo Prep

**Demo script (under 4 minutes):**
1. `npx fourier init` — pick Claude, configure wallet + Telegram + Supabase
2. `npx fourier start` — agent starts, first check fires, reasoning streams in terminal
3. Drain runway artificially to trigger TOP_UP decision
4. Watch model reason out loud
5. Watch execution onchain
6. Telegram message fires
7. Open dashboard URL — event appears live
8. Change `model.provider` to `openai` in config, restart
9. Same scenario — different model, same infrastructure

Step 8-9 is the money shot. Judges see the model-agnostic claim proven live.

---

### Day 14 — Submission

**Submission checklist:**
- Project title: Fourier
- Short description: "An autonomous storage budget manager for Filecoin Onchain Cloud. Plug in any AI model. Walk away."
- Live demo: Vercel dashboard URL
- Repo: GitHub with clean README
- How it uses Filecoin: reads `runwayInEpochs`, `getAccountSummary`, executes `deposit` and dataset management via Synapse SDK — all decisions made onchain
- AI build log: document Claude Code usage
- X post: short, terminal screenshot + dashboard screenshot

---

## Full Tech Stack

| Layer | Tech |
|-------|------|
| Agent core | Node.js + TypeScript |
| FOC | Synapse SDK (`@filoz/synapse-sdk`) |
| Claude adapter | `@anthropic-ai/sdk` |
| OpenAI adapter | `openai` |
| Gemini adapter | `@google/generative-ai` |
| Wallet | `viem` |
| Cloud sync | Supabase |
| Frontend | Next.js 16 |
| Notifications | Telegram Bot API, Discord Webhooks |
| CLI | npm binary (`fourier`) |

---

## Key SDK Methods

| Action | SDK Method |
|--------|-----------|
| Read runway | `payments.getAccountSummary()` → `runwayInEpochs` |
| Read balance | `payments.getAccountSummary()` → `balance` |
| Read providers | `storage.getProviders()` |
| Top up | `payments.deposit({ amount })` |
| List datasets | `storage.listDatasets()` |
| Terminate dataset | `storage.terminateDataset(id)` |

---

## Grant Application Note

After the hackathon, Fourier becomes a ProPGF grant application. Full version adds:
- Multi-wallet management
- Agent-to-agent transfers via Filecoin Pay
- Budget forecasting and spending reports
- Python and Rust agent adapters

Start collecting GitHub stars from submission day.
