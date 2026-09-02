# Fourier

> **Policy-constrained storage budget agent for Filecoin Onchain Cloud.**  
> Built for the Filecoin TLDR Builder Challenge Cycle 4.

Fourier monitors your Filecoin Onchain Cloud storage accounts, calculates storage runway trends, compiles user-authored natural language policies, consults selectable AI providers for structured recommendations, and enforces strict deterministic guardrails before anything can execute.

**Self-hosted by default.** All state lives in local durable JSONL stores (`.fourier/`), the dashboard is a local Node server, and no cloud dependency is required. An optional Supabase mirror can be enabled per-environment without changing the agent's behavior.

> Starting a fresh Filecoin Onchain Cloud project from zero? Use [`npx scaffold-foc`](https://www.npmjs.com/package/scaffold-foc) to scaffold a Next.js + Synapse SDK app with built-in setup checks, then drop Fourier in alongside it.

---

## Documentation

- **[Architecture](docs/architecture.md)** — full component diagram, decision pipeline, data ownership
- **[Threat Model](docs/threat-model.md)** — assets, trust boundaries, 10 mapped threats, failure matrix, non-goals
- **[Calibration Evidence](docs/calibration-evidence.md)** — live onchain deposit + treasury transfer proofs

---

## Architecture Overview

```text
Filecoin Account / Synapse SDK
               │
               ▼
        [ 1. Watcher ] ───► [ Local Durable History ] ──► Accelerating Burn Calculation
               │
               ▼
    [ 2. Memory Context ] ◄── [ agent_memory ] ◄── Outcome Feedback (D_{k-1} vs S_k)
               │
               ▼
      [ 3. AI Brain ] (Claude / OpenAI / Gemini / Grok)
               │
               ▼
   [ 4. Decision Validation ] (Zod Schema Guard)
               │
               ▼
   [ 5. Deterministic Guardrails ] ──► Top-Up Clamped to Policy Max (e.g. 5 USDFC)
               │
      ┌────────┴────────┐
      ▼                 ▼
[ Standalone / Child ] [ Approval Gated (TRIAGE) ]
      │                 │
      ▼                 ▼
[ 6. Filecoin Pay / Tx ] [ Single-Use Token /approve ]
      │
      ▼
[ 7. Multi-Channel Alerts ] (Telegram / Discord / Supabase Event Outbox)
```

> Detailed diagrams (including multi-agent delegation and the optional cloud
> mirror) live in [docs/architecture.md](docs/architecture.md); the security
> analysis is in [docs/threat-model.md](docs/threat-model.md).

---

## Quick Start

### 1. Installation

Requires **Node.js >= 18.0.0**.

```bash
git clone https://github.com/your-org/fourier.git
cd fourier
npm install
npm run build
npm test
```

### 2. Configure Environment

Copy the environment template:

```bash
cp .env.example .env
```

```dotenv
FOURIER_WALLET_PRIVATE_KEY=your_private_key_here
FOURIER_MODEL_API_KEY=your_anthropic_or_openai_api_key
FOURIER_TELEGRAM_BOT_TOKEN=
FOURIER_TELEGRAM_CHAT_ID=
FOURIER_DISCORD_WEBHOOK_URL=
FOURIER_DELEGATION_URL=
FOURIER_DASHBOARD_TOKEN=
FOURIER_SUPABASE_URL=
FOURIER_SUPABASE_SERVICE_ROLE_KEY=
```

**Data source honesty:** with `FOURIER_WALLET_PRIVATE_KEY` (or a `walletAddress` in config) set, the watcher reads live account state through the **Synapse SDK** (`@filoz/synapse-sdk`): payments-contract balances, lockup rate, runway in epochs, and dataset listing. Without any wallet configured, every observation is labeled `demo-fixture` in events and on the dashboard — it is never presented as live chain data, and no signer is constructed.

### 3. Initialize & Author Policy

Initialize configuration and sample policy:

```bash
node packages/agent/dist/src/index.js init --role standalone
```

Compile and review your storage policy:

```bash
node packages/agent/dist/src/index.js policy compile policy.example.txt
```

---

## Simulation Engine (Safe & Zero-Tx)

Fourier provides comprehensive simulation capabilities so every decision can be safely evaluated without constructing signers or sending onchain transactions.

### Named Scenarios

```bash
# 1. Burn-Spike: Naive 9.8d vs 2.1d history-aware projection; 7.5 -> 5.0 USDFC clamp
node packages/agent/dist/src/index.js simulate burn-spike

# 2. Budget-Squeeze: Low balance triggers ranked dataset triage gated by approval token
node packages/agent/dist/src/index.js simulate budget-squeeze
```

### Live Onchain Read Simulation

Inspect your live Filecoin storage state without submitting any onchain transaction:

```bash
node packages/agent/dist/src/index.js simulate
```

### Historical Event Replay

Replay past observations chronologically to inspect what Fourier would have decided:

```bash
node packages/agent/dist/src/index.js simulate --days 7
```

---

## Multi-Agent Delegation

Fourier supports hierarchical multi-agent storage architectures:

- **Child Role (`role: "child"`)**: When storage runway falls below action threshold, posts a funding request to `agent_requests` and polls on a dedicated delegation cycle (default every 5 minutes, configurable via `delegationPollMinutes`).
- **Treasury Role (`role: "treasury"`)**: Runs a dedicated delegation poll (all pending requests per cycle, not just one), uses AI to evaluate solvency and spend policies, and executes **Filecoin Pay** transfers (`payments.deposit` with recipient) directly to child wallets. Child requests carry `requesting_agent_address` so transfers are executable.

```bash
# Initialize a child agent linked to a treasury
node packages/agent/dist/src/index.js init --role child --treasuryId treasury-main
```

**Cross-machine coordination (optional):** by default child and treasury share the local `.fourier/requests.jsonl` queue. To run them on different machines, point both at one dashboard host via `FOURIER_DELEGATION_URL=https://your-host` — the dashboard exposes `POST /api/requests` and `PATCH /api/requests/:id` (token-protected when `FOURIER_DASHBOARD_TOKEN` is set).

---

## Agent Memory & Learning

At the start of each check cycle $k$, Fourier queries the `agent_memory` table, compares previous decision $D_{k-1}$ against current state $S_k$, and updates the outcome (`SUCCESS`, `FAILED: rapid burn`, `STABILIZED`).

The last 10 outcomes are injected directly into the AI prompt under **"Previous decisions and outcomes"** alongside an adaptive learning directive, allowing the agent to continuously adjust its strategy.

---

## Operational Dashboard

Launch the real-time operational dashboard:

```bash
npm run dashboard
```

Open [http://localhost:3000](http://localhost:3000) to inspect:
- **Live Overview**: Storage runway gauges, available/locked balances, trend trajectory, latest decision diff, and a **real subsystem health strip** (watcher freshness, data source, channel config, sync mode) rendered from actual store state — not hardcoded.
- **Simulation Tab (NON-LIVE)**: Interactive scenario runner and N-day historical replay scrub bar.
- **Multi-Agent Delegation Panel**: Live feed of `agent_requests`, treasury AI reasoning, and Filecoin Pay transaction confirmations.
- **Agent Memory & Learning Audit**: Table of historical decision outcomes and adaptive learning insights.
- **Policy Studio**: Live policy compiler and reviewer.

**Security:** the dashboard binds to `127.0.0.1` by default with no CORS wildcard. Set `FOURIER_DASHBOARD_TOKEN` to require `Authorization: Bearer` on every API route and bind to all interfaces for remote access. Without a token, keep it local.

---

## Self-Hosted Architecture

Fourier runs entirely on your machine:

- **Durable local stores** in `.fourier/`: `events.jsonl` (audit trail), `memory.jsonl` (decision memory), `requests.jsonl` (delegation queue), `approvals.json` (single-use approval tokens), plus `agent.lock` and `heartbeat.json`.
- **Optional Supabase mirror**: with `FOURIER_SUPABASE_URL` + `FOURIER_SUPABASE_SERVICE_ROLE_KEY` set, the local event outbox syncs to the `agent_events` table via REST (schema in `supabase/schema.sql`, RLS enabled). Rows are upserted by a deterministic id, so retries never duplicate. Without those vars, sync reports `local-only` and nothing leaves the machine.
- **No required cloud services**: the agent, dashboard, and coordination endpoints all run from this repo.

## Non-Negotiable Safety Invariants

1. **Deterministic Authority**: The AI model proposes; deterministic TypeScript code validates, clamps, gates, and authorizes.
2. **Clamped Top-Ups**: Top-up amounts are capped to `maxAutoTopUpUSDFC`.
3. **Simulation Guarantee**: Simulation mode NEVER accesses private keys or transmits transactions.
4. **TRIAGE Gating**: Dataset triage is disabled by default and requires single-use expiring token approval (`/approve <token>`).
5. **Fault Isolation**: Model timeouts, notification failures, and Supabase lag never crash the main polling loop.
6. **No Secrets in Logs or UI**: Private keys and service role keys are never stored in client bundles or public rows.

---

## License

MIT License.
