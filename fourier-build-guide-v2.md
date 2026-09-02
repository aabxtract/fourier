# Fourier Build Guide v2

**Filecoin TLDR Builder Challenge Cycle 4**  
**Timeline:** 2 weeks, solo  
**Scope:** demo-ready v1 with a safe autonomous loop

This version keeps the original guide intact and changes the build order around the highest-risk assumptions. The central rule is simple: verify the Filecoin SDK and package name before building around them, then make every decision reproducible in simulation before allowing a transaction.

---

## Product Promise

Fourier watches a Filecoin Onchain Cloud account, forecasts storage runway, applies a user-authored policy, asks a selectable AI provider for a structured recommendation, and enforces deterministic safety rules before anything can execute.

```bash
npx @your-scope/fourier init
npx @your-scope/fourier policy compile policy.txt
npx @your-scope/fourier simulate burn-spike
npx @your-scope/fourier start
```

The AI proposes. Fourier validates, clamps, authorizes, executes, records, and reports.

## V1 Boundaries

V1 includes:

- one wallet and one network per agent (with optional multi-agent delegation)
- read-only account and dataset monitoring
- typed policy compilation with a review step
- provider adapters behind one structured-decision contract
- `fourier simulate` (live onchain read without tx execution) and `fourier simulate --days <N>` (historical event replay)
- **Agent Memory + Learning**: Supabase `agent_memory` table, last-10 context injection, and post-cycle outcome feedback
- **Multi-Agent Delegation**: Child and Treasury roles via `agent_requests`, 5-minute polling, and Filecoin Pay transfers
- bounded top-ups and safety clamps
- TRIAGE disabled by default and approval-gated when enabled
- Telegram, Discord, webhook, and Supabase integrations that can fail without stopping the loop
- decision history, multi-agent delegation feed, and a live dashboard with a dedicated Simulation tab

V1 does not include natural-language configuration over Telegram. That is a v2 feature because remote config mutation expands the authentication, replay, validation, and recovery surface immediately before the demo.

---

## Repository Shape

```text
fourier/
|-- packages/
|   |-- agent/
|   |   |-- src/
|   |   |   |-- cli/
|   |   |   |   |-- init.ts
|   |   |   |   |-- start.ts
|   |   |   |   |-- simulate.ts
|   |   |   |   |-- policy.ts
|   |   |   |   `-- use.ts
|   |   |   |-- core/
|   |   |   |   |-- watcher.ts
|   |   |   |   |-- brain.ts
|   |   |   |   |-- memory.ts
|   |   |   |   |-- delegation.ts
|   |   |   |   |-- decision-schema.ts
|   |   |   |   |-- policy.ts
|   |   |   |   |-- guardrails.ts
|   |   |   |   |-- executor.ts
|   |   |   |   |-- loop.ts
|   |   |   |   `-- logger.ts
|   |   |   |-- models/
|   |   |   |-- notifications/
|   |   |   |-- scenarios/
|   |   |   |-- types.ts
|   |   |   `-- index.ts
|   |   |-- test/
|   |   `-- package.json
|   `-- dashboard/
|       `-- app/
|-- policy.example.txt
|-- fourier.config.example.json
`-- package.json
```

---

## Non-Negotiable Safety Invariants

These rules live in code and tests, not only in the model prompt:

1. Invalid or incomplete model output becomes HOLD.
2. A TOP_UP amount is finite, positive, and clamped to the configured maximum.
3. A transaction is never sent during simulation.
4. TRIAGE is disabled by default.
5. TRIAGE requires an existing dataset, an enabled policy, and explicit approval.
6. Model failure, notification failure, and logging failure do not crash the polling loop.
7. Watcher or executor failure is surfaced loudly and never converted into a successful action.
8. Secrets never enter dashboard storage, logs, notifications, Git, or Supabase rows.
9. Every recommendation records the observed state, compiled policy version, raw model output hash, validated decision, guardrail result, execution result, and provider.

---

## Day 0 - De-Risk the Build

**Goal:** replace guessed interfaces with verified facts before committing to the architecture.

### 0.1 Reserve the package identity

Check the intended npm name first:

```bash
npm view fourier name version
npm view @your-scope/fourier name version
```

If `fourier` is occupied, use a scoped package and keep the binary name `fourier`:

```json
{
  "name": "@your-scope/fourier",
  "bin": { "fourier": "./dist/index.js" }
}
```

Do not promise `npx fourier` in the README until the name is confirmed. During development use `npm exec --workspace packages/agent fourier -- ...` or the scoped package name.

### 0.2 Create an SDK spike, not production code

Install the current Synapse SDK in a disposable spike package and inspect its exported types:

```bash
npm install @filoz/synapse-sdk viem
npm exec tsc -- --noEmit
```

Prove these operations on Calibration with a dedicated low-value wallet:

- construct the client with the supported account and network types
- read payment/account state
- identify the exact balance units and runway representation
- list storage contexts or datasets using the actual exported method
- enumerate providers if the SDK supports it
- submit the smallest supported deposit
- identify whether dataset termination exists, what it means, and whether it is reversible
- capture transaction identifiers and failure shapes

Keep a table in `docs/sdk-spike.md`:

| Need | Verified SDK call | Input/output units | Calibration proof | Fallback |
|---|---|---|---|---|
| Account summary | Fill after spike | Fill after spike | tx/read link | Direct contract read or omit |
| Runway | Fill after spike | epochs/seconds/etc. | captured output | Derive from rate and funds |
| Deposit | Fill after spike | token decimals | tx hash | approval-only demo |
| List datasets | Fill after spike | identifiers/status | captured output | fixture in simulation |
| Terminate dataset | Fill after spike | semantics | only if safe | v2/manual action |

The schedule must absorb uncertainty here. If termination is absent or unsafe, the v1 TRIAGE action produces a ranked recommendation plus an approval record, not a destructive chain call.

### 0.3 Prove one provider adapter

Make one request that returns a schema-valid decision. Record the current model name and SDK syntax. The other adapters are not Day 0 blockers.

### 0.4 Define units and fixtures

Create canonical fixtures for:

- healthy runway
- burn spike: naive projection 9.8 days, policy-aware projection 2.1 days
- budget squeeze: insufficient funds and multiple datasets
- malformed model response
- provider timeout
- watcher/RPC failure

**Day 0 exit gate:** package identity is decided; account reads compile and run; units are documented; one provider returns a validated decision; unknown SDK capabilities have explicit fallbacks.

---

## Day 1 - Scaffold, Types, and Secure Config

**Goal:** the monorepo builds and config parsing fails closed.

Use the versions verified on Day 0. Do not paste version numbers from an old guide without checking them.

```json
{
  "name": "fourier-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

Keep secrets in environment variables. The JSON config contains policy and integration settings only:

```json
{
  "agentId": "fourier-demo",
  "network": "calibration",
  "role": "standalone",
  "treasuryAgentId": null,
  "model": {
    "provider": "claude",
    "model": "verified-on-day-0"
  },
  "thresholds": {
    "warningRunwayDays": 7,
    "actionRunwayDays": 3,
    "maxAutoTopUpUSDFC": 5
  },
  "actions": {
    "topUpEnabled": true,
    "triageEnabled": false,
    "triageRequiresApproval": true
  },
  "checkIntervalMinutes": 30
}
```

Config fields for Multi-Agent Delegation:
- `role`: `"standalone"` (default), `"child"`, or `"treasury"`
- `treasuryAgentId`: string ID of target treasury agent (mandatory if `role === "child"`)

Environment variables:

```dotenv
FOURIER_WALLET_PRIVATE_KEY=
FOURIER_MODEL_API_KEY=
FOURIER_TELEGRAM_BOT_TOKEN=
FOURIER_TELEGRAM_CHAT_ID=
FOURIER_DISCORD_WEBHOOK_URL=
FOURIER_WEBHOOK_URL=
FOURIER_SUPABASE_URL=
FOURIER_SUPABASE_SERVICE_ROLE_KEY=
```

Validate config at startup with a schema library (e.g. Zod). Reject invalid networks, negative thresholds, warning thresholds below action thresholds, missing required secrets, invalid `role` values, missing `treasuryAgentId` when `role === "child"`, and intervals below a safe minimum.

Add `.env*`, `fourier.config.json`, wallet files, and local event logs to `.gitignore`. A pre-commit secret scanner is defense in depth, not the primary control.

**Day 1 exit gate:** clean install, build, typecheck, config validation tests, and no secrets in tracked files.

---

## Day 2 - CLI, Policy Compilation, and Simulation

**Goal:** unblock the remaining build with deterministic, transaction-free iteration.

### Commands

```bash
fourier init
fourier policy compile policy.txt
fourier simulate
fourier simulate --days 7
fourier simulate burn-spike
fourier simulate budget-squeeze
fourier start --simulate burn-spike
fourier use openai
```

`--dry-run` may remain as an alias, but the guide and demo use `--simulate` because it communicates that state and outcomes are safely evaluated without transactions.

### Simulation Mode (Live Inspection & Historical Replay)

Fourier provides two primary modes of simulation:

1. **Live Onchain State Simulation (`npx fourier simulate`)**:
   - Reads real live onchain state via the Synapse SDK (same as normal operation).
   - Executes the full `watcher → brain (with memory context) → guardrails → executor` pipeline.
   - **Zero onchain transactions are executed.**
   - Outputs the exact planned actions and estimated runway extension directly to stdout:

   ```text
   [SIMULATION MODE — no transactions will be sent]
   Runway: 3 days
   Balance: 0.8 USDFC
   Model decision: TOP_UP 2 USDFC
   Reasoning: Runway critically low, topping up to extend 33 days
   Would have executed: deposit({ amount: 2 USDFC })
   Estimated new runway: ~33 days
   ```
   - Automatically streams simulation telemetry to the dashboard under a dedicated **"Simulation"** tab clearly labeled as **NON-LIVE**.

2. **Historical Event Replay (`npx fourier simulate --days <N>`)**:
   - Queries the last `N` days (e.g., `--days 7`) of historical `agent_events` from Supabase.
   - Replays the agent's observation history chronologically day-by-day.
   - Shows every decision the agent would have made at each point in time given the actual state then.
   - Pushes the replayed decision trajectory to the dashboard's Simulation tab for retrospective review.

3. **Deterministic Named Scenarios (`fourier simulate <scenario-name>`)**:
   - Evaluates pre-canned edge cases (e.g. `burn-spike`, `budget-squeeze`) without requiring network access.

### Policy compilation

Let the user write:

```text
Warn me below 7 days of runway. Below 3 days, top up at most 5 USDFC.
Preserve customer-ledger and audit-archive before build-cache.
Never terminate a dataset without my approval in Telegram.
```

Compile it to a versioned, reviewable object:

```json
{
  "version": 1,
  "warningRunwayDays": 7,
  "actionRunwayDays": 3,
  "maxAutoTopUpUSDFC": 5,
  "datasetPriority": [
    "customer-ledger",
    "audit-archive",
    "build-cache"
  ],
  "triageEnabled": true,
  "triageRequiresApproval": true
}
```

Compilation is never silent. Show the diff, validate it, and require confirmation before saving. The compiled policy, not the original prose, controls guardrails. Store both plus a hash and timestamp so historical decisions remain explainable.

If AI-based extraction fails, reject the policy. Do not partially merge guessed fields.

### Simulation contract

```ts
export interface Scenario {
  name: string
  now: string
  state: WatcherState
  recentHistory: HistoryPoint[]
  expectedInvariants: string[]
}

export interface ExecutionContext {
  mode: 'live' | 'simulate'
  scenario?: string
  replayDays?: number
}
```

The executor must check mode before constructing a wallet client or submitting anything:

```ts
if (context.mode === 'simulate') {
  return {
    status: 'simulated',
    summary: describePlannedAction(decision),
    transactionId: null,
    estimatedNewRunwayDays: calculateProjectedRunway(state, decision)
  }
}
```

Simulation uses the same decision validation, policy, guardrails, memory lookup, notification formatting, and logging shape as live mode. Only transaction dispatch is safely replaced.

**Day 2 exit gate:** `fourier simulate` reads live onchain state without transacting; `fourier simulate --days 7` replays historical events; both named scenarios run offline; no wallet secret is required; malformed decisions HOLD; simulated actions cannot reach an SDK write method.

---

## Day 3 - Verified Watcher and History

**Goal:** turn verified SDK output into a stable internal state.

Define an internal boundary that does not leak SDK-specific types:

```ts
export interface WatcherState {
  observedAt: string
  runwayDays: number
  availableUSDFC: number
  lockedUSDFC: number
  spendRateUSDFCPerDay: number | null
  datasets: DatasetState[]
  source: 'live' | 'scenario'
}
```

Use conversion helpers for token decimals and time units. Never use `Number(bigint) / 1e18`; format units with the chain library, then parse only after range checks.

Append each successful observation to local durable history before calling the model. Compute burn rate from a bounded time window and mark projections as unavailable until enough samples exist.

History is what makes the burn-spike scenario meaningful: a point-in-time balance suggests 9.8 days, while the recent accelerating burn rate produces 2.1 days.

Watcher errors return a typed failure. They do not fabricate zero balances or zero runway because that could trigger a false emergency action.

**Day 3 exit gate:** Calibration reads match the Day 0 fixture; unit conversion tests pass; history survives restart; an RPC failure causes no decision or execution.

---

## Day 4 - Model-Agnostic Brain, Memory + Learning, and Decision Validation

**Goal:** all providers implement one contract, untrusted output becomes a validated proposal, and the agent learns from historical decision outcomes.

```ts
export type Decision =
  | { action: 'HOLD'; reasoning: string }
  | { action: 'WARN'; reasoning: string }
  | { action: 'TOP_UP'; amountUSDFC: number; reasoning: string }
  | {
      action: 'TRIAGE'
      rankedDatasetIds: string[]
      reasoning: string
    }

export type TreasuryDecision =
  | { action: 'APPROVE'; requestId: string; transferAmountUSDFC: number; reasoning: string }
  | { action: 'REJECT'; requestId: string; reasoning: string }
```

### Agent Memory + Learning Integration

Before generating a proposal, the brain queries the last 10 memory records from the `agent_memory` Supabase table for the active `agent_id`.

The prompt injects this history under a dedicated **"Previous decisions and outcomes"** section:

```markdown
## Previous decisions and outcomes (last 10)
- [2026-08-28 14:00] Action: TOP_UP (2 USDFC) at 3.1d runway -> Outcome: SUCCESS (runway extended to 34 days)
- [2026-08-29 08:30] Action: HOLD at 3.0d runway -> Outcome: FAILED (rapid burn rate caused critical drop to 0.4d before next cycle)
- [2026-08-29 12:00] Action: TOP_UP (5 USDFC) at 0.4d runway -> Outcome: SUCCESS (emergency top-up restored healthy state)
```

**Learning directive in system prompt:**
> "Review your previous decisions and their outcomes above. If past decisions (such as waiting to top up at 3 days) repeatedly produced poor outcomes or failure states under accelerating burn rates, adapt your strategy by acting earlier or adjusting top-up amounts within policy bounds."

### Treasury Agent Decision Evaluation (Multi-Agent Role)

When `role === "treasury"`, the brain receives pending child requests from `agent_requests` alongside treasury liquid balance and burn metrics. The model evaluates whether the child agent's request is justified without compromising treasury solvency.

### Decision Parsing and Validation

Parse and validate every response:

```ts
export function parseDecision(raw: string): Decision {
  try {
    const json: unknown = JSON.parse(stripCodeFence(raw))
    return DecisionSchema.parse(json)
  } catch {
    return {
      action: 'HOLD',
      reasoning: 'Model output failed decision validation.'
    }
  }
}
```

Validation must reject:

- unknown actions or extra privileged fields
- NaN, infinity, zero, negative, or non-numeric top-ups
- missing or blank reasoning
- unknown or duplicate dataset IDs
- TRIAGE without an ordered list
- oversized output

Do not accidentally return HOLD for every valid response: the success path must return the parsed schema result. Add one test for every action plus malformed JSON and schema-invalid JSON.

Provider adapters return text or a typed provider error. Configure timeouts and do not retry non-idempotent downstream actions merely because the model request was retried.

**Day 4 exit gate:** the same fixtures pass through at least Claude and OpenAI adapters; memory history correctly formats in prompt; treasury evaluation parses safely; all action variants have parser tests; provider failure becomes HOLD with a visible error category.

---

## Day 5 - Guardrails, Approval, and Executor

**Goal:** deterministic code owns authority.

Apply guardrails after parsing and before execution:

```ts
export function enforceGuardrails(
  proposal: Decision,
  state: WatcherState,
  policy: CompiledPolicy
): GuardrailResult {
  if (proposal.action === 'TOP_UP') {
    if (!policy.topUpEnabled) return hold('TOP_UP is disabled')

    const amountUSDFC = Math.min(
      proposal.amountUSDFC,
      policy.maxAutoTopUpUSDFC
    )

    if (!Number.isFinite(amountUSDFC) || amountUSDFC <= 0) {
      return hold('TOP_UP amount is invalid')
    }

    return allow({ ...proposal, amountUSDFC }, {
      clamped: amountUSDFC !== proposal.amountUSDFC
    })
  }

  if (proposal.action === 'TRIAGE') {
    if (!policy.triageEnabled) return hold('TRIAGE is disabled')
    if (policy.triageRequiresApproval) return requireApproval(proposal)
  }

  return allow(proposal)
}
```

### Multi-Agent Delegation Execution Logic

When role-based delegation is active, execution paths fork based on `fourier.config.json`:

1. **Child Agent (`role: "child"`)**:
   - When runway drops below `actionRunwayDays` and the decision is `TOP_UP`:
     - Instead of initiating an onchain deposit from its own wallet, the child agent posts a funding request to `agent_requests`:
       ```json
       {
         "requesting_agent_id": "child-agent-01",
         "treasury_agent_id": "treasury-agent-main",
         "amount_requested": 5.0,
         "reason": "Storage runway is 2.8 days, below action threshold 3.0 days",
         "status": "pending"
       }
       ```
     - Enters a polling state, checking `agent_requests` every **5 minutes** for status change.
     - When `status === "approved"`, the child verifies balance arrival and proceeds — the treasury has completed the Filecoin Pay transfer.
     - If rejected or timeout exceeds policy limits, dispatches local warning and falls back to hold/alert.

2. **Treasury Agent (`role: "treasury"`)**:
   - Polls `agent_requests` every **5 minutes** for records with `treasury_agent_id === this.agentId` and `status === "pending"`.
   - For each pending request:
     - Asks the AI model to evaluate the request against current treasury balance and spend policy.
     - **If approved**: executes a **Filecoin Pay transfer** (or Calibration native token transfer) directly to the requesting child agent's wallet address, updates request `status` to `"approved"`, and logs the transaction.
     - **If rejected**: updates `status` to `"rejected"` with justification, and sends alert notifications via Telegram and Discord.
   - Both agents emit realtime updates to the dashboard.

**Day 5 exit gate:** top-up clamp tests pass; child agent creates requests rather than self-funding; treasury agent safely evaluates and executes Filecoin Pay transfers; TRIAGE is off by default; approval tokens are single-use and expiring; simulation never constructs a signer; duplicate execution is prevented.

---

## Day 6 - Notifications That Can Fail

**Goal:** useful alerts without coupling agent health to third-party availability.

Use timeouts, response checks, escaped formatting, and bounded retries with jitter. Notifications are best-effort after the decision and execution result are durably recorded.

Do not use Telegram Markdown with unescaped model-generated reasoning. Either escape it correctly or send plain text.

### What happens when this call fails?

- Telegram/Discord/webhook failure is recorded with destination, status class, attempt count, and next retry time.
- The main check completes and the next scheduled check still runs.
- Retries are bounded and do not duplicate onchain execution.
- Secrets and full webhook URLs are redacted from logs.
- Approval delivery failure leaves the action pending, never implicitly approved.

**Day 6 exit gate:** timeout, 429, 500, malformed response, and invalid credential tests pass; a notification outage cannot stop simulated checks.

---

## Day 7 - Supabase Event Store, Memory, Delegation, and RLS

**Goal:** history, agent memory, and multi-agent delegation are cleanly queryable and isolated with Row Level Security.

### Database Schema

```sql
-- 1. Agent Events (Audit & Replay Log)
create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  user_id uuid references auth.users(id),
  mode text not null check (mode in ('live', 'simulate')),
  runway_days numeric not null,
  available_usdfc numeric not null,
  spend_rate_per_day numeric,
  action text not null,
  guardrail_status text not null,
  execution_status text not null,
  tx_hash text,
  reasoning text not null,
  raw_output_hash text not null,
  policy_version int not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_events_lookup 
on public.agent_events (agent_id, created_at desc);

-- 2. Agent Memory (Learning & Decision Feedback)
create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  user_id uuid references auth.users(id),
  action text not null check (action in ('TOP_UP', 'TRIAGE', 'HOLD', 'WARN')),
  runway_days_at_decision numeric not null,
  amount_if_topup numeric,
  outcome text, -- initially null; evaluated and updated on next check cycle
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_memory_fetch 
on public.agent_memory (agent_id, created_at desc);

-- 3. Agent Requests (Multi-Agent Delegation)
create table if not exists public.agent_requests (
  id uuid primary key default gen_random_uuid(),
  requesting_agent_id text not null,
  treasury_agent_id text not null,
  user_id uuid references auth.users(id),
  amount_requested numeric not null check (amount_requested > 0),
  reason text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')) default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_requests_queue 
on public.agent_requests (treasury_agent_id, status, created_at asc);
```

### Row Level Security (RLS)

Enable Row Level Security across all tables:

```sql
alter table public.agent_events enable row level security;
alter table public.agent_memory enable row level security;
alter table public.agent_requests enable row level security;

revoke all on table public.agent_events from anon, authenticated;
revoke all on table public.agent_memory from anon, authenticated;
revoke all on table public.agent_requests from anon, authenticated;

-- Dashboard user read policies
create policy "dashboard reads owned agent events"
on public.agent_events for select to authenticated
using (user_id = auth.uid());

create policy "dashboard reads owned agent memory"
on public.agent_memory for select to authenticated
using (user_id = auth.uid());

create policy "dashboard reads owned agent requests"
on public.agent_requests for select to authenticated
using (user_id = auth.uid());
```

### Memory Outcome Feedback Loop

At the beginning of each check cycle $k$:
1. Fetch the most recent memory row for this `agent_id` where `outcome IS NULL`.
2. Compare the previous decision $D_{k-1}$ against the current observed state $S_k$:
   - If action was `TOP_UP` and runway increased: `outcome = 'SUCCESS: runway extended to ' || current_runway || ' days'`
   - If action was `HOLD` and runway dropped into emergency threshold: `outcome = 'FAILED: runway depleted to ' || current_runway || ' days without intervention'`
   - If action was `WARN` and user/operator took action or status stabilized: `outcome = 'STABILIZED'`
3. Update `agent_memory.outcome` in Supabase before requesting the next model decision.

Preferred architecture:
- the local agent writes through a narrow authenticated server endpoint or Edge Function holding the service role key (or uses direct client with authenticated tokens)
- dashboard users authenticate and can read only rows mapped to their user ID
- the browser receives only the anon key

Never put a Supabase service role key in `NEXT_PUBLIC_*`, config downloads, or the agent event payload.

### What happens when this call fails?

- Events and memory writes first enter a local durable SQLite/file outbox.
- Supabase delivery retries independently in the background.
- The polling loop continues uninterrupted.
- Dashboard lag is visible as a sync warning.
- Replayed outbox entries use an idempotency key to avoid duplicates.

**Day 7 exit gate:** cross-user reads are denied; `agent_memory` and `agent_requests` tables pass RLS; memory outcome updates link correctly across cycles; offline events sync after reconnect.

---

## Day 8 - Resilient Main Loop and `fourier start`

**Goal:** the agent can be left running without overlapping checks or dying on one exception.

```ts
export async function runLoop(deps: Dependencies): Promise<void> {
  let stopped = false

  const stop = () => { stopped = true }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  while (!stopped) {
    const startedAt = Date.now()

    try {
      await runOneCheck(deps)
    } catch (error) {
      await deps.errors.record(classifyError(error))
    }

    const elapsed = Date.now() - startedAt
    await deps.clock.sleep(Math.max(0, deps.intervalMs - elapsed))
  }
}
```

Use a single loop rather than an unguarded `setInterval`, which can overlap when a check takes longer than the interval. Add a process lock so two `fourier start` processes cannot control the same agent accidentally.

`runOneCheck` order:

1. **Evaluate Memory Outcome**: Read current state $S_k$, compare against previous decision $D_{k-1}$, and update previous `agent_memory.outcome`
2. **Retrieve Context**: Fetch last 10 memory rows from `agent_memory` for this `agent_id`
3. **Acquire State**: Read live state via Synapse SDK (or load scenario fixture)
4. **Append Observation**: Record observation to local history and compute burn trend
5. **Brain Inference**: Request model proposal with prompt including compiled policy, current state, and the "Previous decisions and outcomes" memory block
6. **Validate Proposal**: Parse through Zod schema and ensure invariants hold
7. **Enforce Guardrails**: Check against policy caps, clamp top-ups, enforce approval requirements
8. **Role-Based Execution Dispatch**:
   - **Standalone**: Check approval and dispatch onchain top-up if authorized
   - **Child**: Post funding request to `agent_requests` and poll every 5 minutes for approval
   - **Treasury**: Poll `agent_requests` for pending items, run AI evaluation, execute Filecoin Pay transfer on approval, or notify rejection
9. **Record Memory & Event**: Write current decision to `agent_memory` (`outcome: null`) and append full audit record to `agent_events`
10. **Fan Out**: Independently dispatch Telegram/Discord alerts and sync outbox to Supabase

### What happens when this call fails?

- Watcher failure: record CHECK_FAILED; do not call the model or executor.
- Model failure: HOLD; record provider error; continue schedule.
- Validation failure: HOLD; preserve a redacted output hash for diagnosis.
- Executor failure: record EXECUTION_FAILED or UNKNOWN; never report success.
- Memory/Logger failure: keep the event and memory update in the local outbox.
- Notification failure: retry independently.
- Unexpected exception: catch at the check boundary, report it, and continue after backoff.

**Day 8 exit gate:** fault-injection tests cover every step; memory outcomes update sequentially; multi-agent polling handles network blips; checks do not overlap; Ctrl+C drains current durable writes; the loop survives 100 simulated iterations with injected failures.

---

## Days 9-10 - Operational Dashboard

**Goal:** make state, reasoning, memory learning, delegation, and simulation inspectable in real time.

Build the product screen first, not a marketing landing page. The dashboard should show:

- **Live Overview**:
  - live/simulated mode badge and network
  - current runway plus recent trend graph
  - last successful observation time
  - compiled policy version and hash
  - provider and model selection
  - proposal versus guardrail-adjusted decision
  - execution transaction identifier when present
  - notification and Supabase sync health

- **Simulation Tab (Clearly marked NON-LIVE)**:
  - Live onchain simulation results: simulated runway extension, predicted balance, zero-transaction verification
  - Historical replay timeline (`--days <N>`): day-by-day scrub bar showing what the model would have decided at each timestamp given actual past state

- **Multi-Agent Delegation Panel**:
  - Live feed of `agent_requests` (requesting agent, target treasury, amount, reason, status)
  - Treasury AI evaluation reasoning and approval/rejection justification
  - Filecoin Pay transfer transaction hashes and confirmation badges

- **Agent Memory & Learning Audit**:
  - Interactive table of `agent_memory` (action, runway at decision, top-up amount, evaluated outcome)
  - Visual indicator showing model behavioral adjustments over time

The setup UI must never request or download a wallet private key. It may generate a non-secret config and show which environment variables the local agent needs.

Keep realtime subscriptions scoped by authenticated ownership. Unsubscribe on unmount and handle disconnected/reconnecting states.

**Days 9-10 exit gate:** desktop and mobile views are usable; non-live Simulation tab renders live checks and N-day replay; delegation feed updates in realtime; another user cannot query the agent; offline/stale state is visibly different from healthy live state; both demo scenarios render from stored events.

---

## Day 11 - Reliability and Demo Hardening

**Goal:** spend the recovered day on the claim that Fourier can be left running.

Natural-language Telegram configuration moves to v2. Use this day for:

- fault-injection runs across watcher, providers, executor, notifications, and Supabase
- restart and outbox replay tests
- duplicate-process and duplicate-execution tests
- approval expiry and replay tests
- redaction review
- a Calibration top-up rehearsal with the smallest safe amount
- a fully offline demo fallback
- timing the scripted demo three times

Create a one-page failure matrix:

| Dependency | Timeout | Retry | Persistent state | User-visible result | Can execute? |
|---|---:|---:|---|---|---|
| RPC/watcher | yes | bounded | check failure | stale/offline | no |
| AI provider | yes | bounded | HOLD event | provider error | no |
| Executor/RPC | yes | cautious | pending/unknown | reconcile required | no retry until reconciled |
| Telegram | yes | bounded | delivery outbox | delivery warning | decision unaffected |
| Supabase | yes | outbox | local event | sync warning | decision unaffected |

**Day 11 exit gate:** the failure matrix matches observed tests; no critical demo step depends on an untested network call.

---

## Day 12 - README, Security Review, and Release Candidate

**Goal:** publish documentation that matches the actual safety model.

README checklist:

- exact verified install command and package name
- Node version and supported platforms
- Calibration-first setup
- environment variables and secret storage
- policy compilation and review workflow
- `simulate` examples before `start`
- live mode warning and smallest-safe-funds recommendation
- TRIAGE disabled by default
- Telegram approval authentication, expiry, and replay behavior
- top-up clamping and decision validation
- Supabase RLS architecture and warning never to expose the service role key
- local history/outbox location, retention, and deletion
- provider/RPC/notification failure behavior
- transaction reconciliation behavior
- threat model and explicit non-goals
- key rotation and incident steps
- uninstall/revoke steps

Security notes must explicitly say:

- never paste a private key into the dashboard or commit it to Git
- use a dedicated low-value wallet, especially for the demo
- model output is untrusted input
- agent IDs are not authorization secrets
- Telegram chat ID checks alone are not sufficient for broad remote administration
- service role credentials are server-only
- simulation is the default path for evaluation and demos

Run build, typecheck, tests, package dry-run, install-from-tarball, and secret scanning. Publish only the release candidate that passed those checks.

**Day 12 exit gate:** a fresh directory can install the tarball, initialize, compile policy, and run both simulations from README instructions.

---

## Day 13 - Demo Rehearsal

**Goal:** prove why AI is useful without making safety depend on it.

### Demo script, under four minutes

1. Compile policy from a typed paragraph.

   ```bash
   fourier policy compile demo-policy.txt
   ```

   Show the extracted thresholds, dataset priority order, top-up cap, and approval requirement. Confirm the compiled policy.

2. Run the burn-spike simulation.

   ```bash
   fourier simulate burn-spike
   ```

   Show that the naive point-in-time answer is **9.8 days**, but history-aware reasoning detects accelerating spend and projects **2.1 days**. Show the model proposal and the deterministic top-up cap.

3. Run the budget-squeeze simulation.

   ```bash
   fourier simulate budget-squeeze
   ```

   Show ranked dataset triage based on the compiled policy. Fourier sends an immutable approval request to Telegram. Approve it with:

   ```text
   /approve <single-use-token>
   ```

   The simulation records approval and the action it would take; it sends no transaction.

4. Switch providers and repeat the same scenario.

   ```bash
   fourier use openai
   fourier simulate budget-squeeze
   ```

   Show that phrasing may change, but the compiled policy, schema validation, ranked constraints, approval requirement, and no-transaction simulation invariant remain intact.

Step 4 is the money shot: the reasoning is provider-agnostic, and the safety rails hold regardless of provider.

Keep a prerecorded screen capture and local fixture mode ready. Do not drain a live wallet or depend on changing live chain state during the judged demo.

**Day 13 exit gate:** three timed runs below four minutes; clean terminal history; Telegram and offline fallback both rehearsed; dashboard already contains representative events.

---

## Day 14 - Submission

Submission checklist:

- project title and one-sentence description match the shipped scope
- repository has a clean README, license, architecture diagram, and threat model
- dashboard URL opens without secrets in client bundles
- demo video follows the Day 13 script
- Calibration transaction evidence is linked separately from the deterministic demo
- AI build log distinguishes AI-generated suggestions from verified SDK behavior
- known limitations include one-wallet scope, provider availability, and v2 Telegram config
- package installation command is tested from an empty directory

Suggested description:

> Fourier is a policy-constrained storage budget agent for Filecoin Onchain Cloud. It combines history-aware AI recommendations with deterministic limits, approval gates, simulation, and an auditable event trail.

---

## V2 Backlog

Move these features after the demo:

- natural-language config updates over Telegram
- multi-wallet management across multiple sub-networks
- automated dataset termination, only after SDK semantics and recovery are proven
- richer forecasting and spending reports
- cross-chain and multi-treasury consensus workflows
- additional language SDKs
- policy rollback and multi-approver workflows

For Telegram configuration, require signed or strongly authenticated commands, schema validation, a preview/diff, explicit confirmation, an append-only audit record, rate limiting, replay protection, and rollback. Do not implement it as `Object.assign` over model-extracted JSON.

---

## Verification Matrix

| Capability | Unit | Integration | Demo evidence |
|---|---|---|---|
| Config validation | invalid fields & roles rejected | fresh init | init output with role |
| Policy compilation | extraction/schema/diff | compile fixture | typed paragraph |
| History forecast | burn-rate fixtures | persisted restart | 9.8d vs 2.1d |
| Decision parsing | every action + invalid output | two providers | provider switch |
| Agent Memory + Learning | memory schema & prompt context | last 10 fetch & outcome update | learned threshold adjustment |
| Multi-Agent Delegation | request creation & treasury eval | 5m polling & Filecoin Pay tx | live dashboard request feed |
| Top-up clamp | boundary/property tests | simulated executor | clamp shown |
| TRIAGE gating | disabled/approval/replay tests | Telegram sandbox | `/approve` |
| Live Simulation | signer/write spies unused | `fourier simulate` | zero tx, live state report |
| Historical Replay | date range queries & scrub bar | `fourier simulate --days 7` | day-by-day replay log |
| Loop resilience | injected failures | 100 iterations | health view |
| Supabase security | RLS on events, memory & requests | two test users | scoped dashboard |
| Packaging | tarball contents | empty-directory install | exact install command |

---

## Definition of Done

Fourier v1 is done when a new user can install it, author and review a policy, run live and historical simulations, inspect agent memory learning from past outcomes, test multi-agent treasury delegation, switch between two AI providers, see deterministic safety invariants enforced, inspect full decision history on the dashboard, and understand exactly what happens when any external dependency fails. A live Calibration write is supporting evidence, not the foundation of the demo.
