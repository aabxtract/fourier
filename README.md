# Fourier

> **Policy-constrained storage budget agent for Filecoin Onchain Cloud.**  
> Built for the Filecoin TLDR Builder Challenge Cycle 4.

Fourier monitors your Filecoin Onchain Cloud storage accounts, calculates storage runway trends, compiles user-authored natural language policies, consults selectable AI providers for structured recommendations, and enforces strict deterministic guardrails before anything can execute.

**Self-hosted by default.** All state lives in local durable JSONL stores (`.fourier/`), the dashboard is a local Node server, and no cloud dependency is required. An optional Neon Postgres mirror can be enabled per-environment without changing the agent's behavior.

> Starting a fresh Filecoin Onchain Cloud project from zero? Use [`npx scaffold-foc`](https://www.npmjs.com/package/scaffold-foc) to scaffold a Next.js + Synapse SDK app with built-in setup checks, then drop Fourier in alongside it.

---

## Documentation

- **[Architecture](docs/architecture.md)** — full component diagram, decision pipeline, data ownership
- **[Threat Model](docs/threat-model.md)** — assets, trust boundaries, 10 mapped threats, failure matrix, non-goals
- **[Calibration Evidence](docs/calibration-evidence.md)** — live onchain deposit + treasury transfer proofs
- **Landing page**: https://fourier-landing.vercel.app · **Live view**: https://fourier-view.vercel.app

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
      [ 3. AI Brain ] (Claude / OpenAI / Gemini / Grok / Groq)
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
[ 7. Multi-Channel Alerts ] (Telegram / Discord / Neon Cloud Mirror)
```

> Detailed diagrams (including multi-agent delegation and the optional cloud
> mirror) live in [docs/architecture.md](docs/architecture.md); the security
> analysis is in [docs/threat-model.md](docs/threat-model.md).

---

## Quick Start

### 1. Install

Requires **Node.js >= 18**. No cloning needed — the agent runs from anywhere:

```bash
npx fourier-agent init
```

(Developers who want the dashboard, viewer, or to contribute: `git clone` this
repo, then `npm install && npm run build` — the npm package ships the agent
CLI only.)

### 2. Configure Environment — automatically

`init` walks you through everything interactively and writes `.env` for you —
including **automatic Telegram chat-id discovery** (paste your bot token, send
it any message, and the chat id is found and saved):

```bash
fourier setup          # re-run anytime; existing values are kept unless overwritten
```

Secrets it can store: wallet private key (masked input), AI provider key,
Telegram bot token + chat id, Discord webhook, Neon connection string, and the
online-view URL. Prefer manual editing? Create `.env` yourself:

```dotenv
FOURIER_WALLET_PRIVATE_KEY=your_private_key_here
FOURIER_MODEL_API_KEY=your_anthropic_or_openai_api_key
FOURIER_TELEGRAM_BOT_TOKEN=
FOURIER_TELEGRAM_CHAT_ID=
FOURIER_DISCORD_WEBHOOK_URL=
FOURIER_DATABASE_URL=
FOURIER_VIEW_URL=https://fourier-view.vercel.app
```

**Data source honesty:** with `FOURIER_WALLET_PRIVATE_KEY` (or a `walletAddress` in config) set, the watcher reads live account state through the **Synapse SDK** (`@filoz/synapse-sdk`): payments-contract balances, lockup rate, runway in epochs, and dataset listing. Without any wallet configured, every observation is labeled `demo-fixture` in events and on the dashboard — it is never presented as live chain data, and no signer is constructed.

### 3. Author Your Policy

Compile and review your storage policy (plain English in, versioned rulebook out):

```bash
fourier policy compile policy.txt
```

### 4. Test-drive, then run

```bash
fourier simulate burn-spike     # the full pipeline, zero transactions
fourier start                   # the autonomous agent loop
```

---

## CLI Reference

| Command | What it does |
|---|---|
| `fourier init` | Create config + sample policy, then interactively store your keys in `.env` |
| `fourier setup` | Re-run the interactive key setup (wallet, AI key, Telegram + auto chat-id, Discord, Neon) |
| `fourier policy compile <file>` | Compile plain-English policy into the versioned rulebook |
| `fourier simulate [scenario]` | Zero-tx pipeline run: named scenario, live onchain read, or `--days N` replay |
| `fourier start [--simulate <scenario>]` | The autonomous agent loop (or a single simulated check) |
| `fourier status` / `fourier stop` | Liveness from the lockfile + heartbeat / graceful shutdown |
| `fourier use <provider>` | Switch AI provider: claude, openai, gemini, grok, groq |
| `fourier link [--rotate/--show]` | Access code for the code-gated online view |
| `fourier approve <token>` | Redeem a single-use TRIAGE approval token |
| `fourier demo` | Scripted 5-cycle demo run |

---

## Simulation Engine (Safe & Zero-Tx)

Fourier provides comprehensive simulation capabilities so every decision can be safely evaluated without constructing signers or sending onchain transactions.

### Named Scenarios

```bash
# 1. Burn-Spike: Naive 9.8d vs 2.1d history-aware projection; 7.5 -> 5.0 USDFC clamp
fourier simulate burn-spike

# 2. Budget-Squeeze: Low balance triggers ranked dataset triage gated by approval token
fourier simulate budget-squeeze
```

### Live Onchain Read Simulation

Inspect your live Filecoin storage state without submitting any onchain transaction:

```bash
fourier simulate
```

### Historical Event Replay

Replay past observations chronologically to inspect what Fourier would have decided:

```bash
fourier simulate --days 7
```

---

## Multi-Agent Delegation

Fourier supports hierarchical multi-agent storage architectures:

- **Child Role (`role: "child"`)**: When storage runway falls below action threshold, posts a funding request to `agent_requests` and polls on a dedicated delegation cycle (default every 5 minutes, configurable via `delegationPollMinutes`).
- **Treasury Role (`role: "treasury"`)**: Runs a dedicated delegation poll (all pending requests per cycle, not just one), uses AI to evaluate solvency and spend policies, and executes **Filecoin Pay** transfers (`payments.deposit` with recipient) directly to child wallets. Child requests carry `requesting_agent_address` so transfers are executable.

```bash
# Initialize a child agent linked to a treasury
fourier init --role child --treasuryId treasury-main
```

**Cross-machine coordination (optional):** by default child and treasury share the local `.fourier/requests.jsonl` queue. To run them on different machines, point both at one dashboard host via `FOURIER_DELEGATION_URL=https://your-host` — the dashboard exposes `POST /api/requests` and `PATCH /api/requests/:id` (token-protected when `FOURIER_DASHBOARD_TOKEN` is set).

---

## Telegram & Alerts

Configure once with `fourier setup` — the bot token is validated against
Telegram's API and your **chat id is discovered automatically** (you just send
the bot any message). From then on:

- Every decision pushes to Telegram (and Discord/webhook if configured) with
  a link to your personal live view
- Natural-language chat: ask about your account, request simulations
- `/approve <token>` redeems TRIAGE approval tokens; `/link` re-sends your
  access code and view link
- Chat is pinned to your chat id — messages from anyone else are ignored

---

## Agent Memory & Learning

At the start of each check cycle $k$, Fourier compares its previous decision $D_{k-1}$ against the current observed state $S_k$ and grades the outcome (`SUCCESS`, `FAILED: rapid burn`, `STABILIZED`) into the `agent_memory` store.

The last 10 graded outcomes are injected directly into the AI prompt under **"Previous decisions and outcomes"** alongside an adaptive learning directive, allowing the agent to continuously adjust its strategy.

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

## Online View (code-gated, no logins)

Every Fourier installation can mirror its data to a Neon Postgres database and expose a **read-only live view** on any device — the access code is the account:

```bash
# 1. Set your Neon connection string in .env
FOURIER_DATABASE_URL=postgresql://...

# 2. Run the schema once (neon/schema.sql) in the Neon SQL editor

# 3. Generate your access code (prints once; re-sendable via Telegram /link)
fourier link

# 4. Run the hosted viewer (deployable to Vercel/any host, or local)
npm run view
```

- Enter the code — or open the `?code=` link from Telegram — and see runway, decisions, delegation and memory live (5s polling)
- Codes are high-entropy, stored **hashed** in the cloud, and rotatable: `fourier link --rotate`
- Every Telegram alert includes a link to your live view
- **The cloud layer is read-only by construction** — no keys, no execution, no approvals online. The local bot keeps full authority

## Self-Hosted Architecture

Fourier runs entirely on your machine:

- **Durable local stores** in `.fourier/`: `events.jsonl` (audit trail), `memory.jsonl` (decision memory), `requests.jsonl` (delegation queue), `approvals.json` (single-use approval tokens), plus `agent.lock` and `heartbeat.json`.
- **Optional Neon mirror**: with `FOURIER_DATABASE_URL` set, the agent mirrors events, memory outcomes, delegation requests, and its policy snapshot to a Neon Postgres database (`neon/schema.sql`). Rows are upserted by deterministic ids, so retries never duplicate. Without it, sync reports `local-only` and nothing leaves the machine.
- **No required cloud services**: the agent, dashboard, and coordination endpoints all run from this repo.

## Non-Negotiable Safety Invariants

1. **Deterministic Authority**: The AI model proposes; deterministic TypeScript code validates, clamps, gates, and authorizes.
2. **Clamped Top-Ups**: Top-up amounts are capped to `maxAutoTopUpUSDFC`.
3. **Simulation Guarantee**: Simulation mode NEVER accesses private keys or transmits transactions.
4. **TRIAGE Gating**: Dataset triage is disabled by default and requires single-use expiring token approval (`/approve <token>`).
5. **Fault Isolation**: Model timeouts, notification failures, and cloud-mirror lag never crash the main polling loop.
6. **No Secrets in Logs or UI**: Private keys and service role keys are never stored in client bundles or public rows.

---

## License

MIT License.
