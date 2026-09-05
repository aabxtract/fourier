# Architecture

Fourier is a self-hosted, policy-constrained storage budget agent for Filecoin
Onchain Cloud. The AI proposes; deterministic TypeScript code validates,
clamps, gates, authorizes, executes, records, and reports.

```mermaid
flowchart TD
    subgraph CHAIN["Filecoin Onchain Cloud (Calibration/Mainnet)"]
        PAY["Filecoin Pay contract<br/>(USDFC balance, lockup, rails)"]
        DS["DataSets / storage"]
    end

    subgraph AGENT["Fourier Agent (node process, self-hosted)"]
        LOOP["Main Loop<br/>runOneCheck every N min<br/>+ dedicated delegation poll (5 min)<br/>lock · heartbeat · SIGINT drain"]

        WATCHER["Watcher<br/>source: live / scenario / demo-fixture"]
        HIST["Local durable history<br/>burn-rate + runway projection<br/>(naive vs history-aware)"]
        MEM["MemoryStore<br/>outcome feedback D(k-1) vs S(k)<br/>last-10 prompt injection"]

        BRAIN["AI Brain<br/>claude · openai · gemini · grok · groq · mock"]
        WS["Workspace prompts<br/>SOUL · TOOLS · USER · MEMORY"]

        VAL["Decision validation<br/>unknown shape/amount/id → HOLD"]
        GUARD["Guardrails<br/>clamp to maxAutoTopUpUSDFC<br/>TRIAGE off by default"]

        APPROVE["ApprovalStore<br/>single-use · 10-min TTL · SHA-256 tamper check"]

        EXEC["Executor"]
        DEL["Delegation<br/>child: post request + settle<br/>treasury: AI eval + Filecoin Pay"]

        STORE[("EventStore (.fourier/events.jsonl)<br/>audit record + outbox")]
        REQ[("RequestStore<br/>requests.jsonl or remote")]
    end

    subgraph NOTIFY["Alerts (outbound, failure-isolated)"]
        TG["Telegram"]
        DC["Discord"]
        WH["Webhook"]
    end

    subgraph LISTEN["Chat listeners (inbound, never block loop)"]
        TGL["TelegramListener"]
        DCL["DiscordListener"]
        CONV["ConversationEngine<br/>NL chat · /approve token"]
    end

    subgraph MIRROR["Optional cloud mirror"]
        SB[("Neon Postgres agent_events<br/>cloud mirror · server-side creds only")]
    end

    subgraph DASH["Operational Dashboard (node http)"]
        SRV["API server<br/>token auth · localhost by default"]
        UI["SPA: Overview · Simulation (NON-LIVE)<br/>Delegation · Memory · Policy Studio"]
    end

    SDK["Synapse SDK (@filoz/synapse-sdk)"]

    CHAIN -->|"payments.accountSummary()<br/>storage.findDataSets()"| SDK --> WATCHER
    WATCHER --> HIST --> LOOP
    LOOP -->|"evaluate outcome k-1"| MEM
    MEM -->|"last-10 context"| BRAIN
    WS --> BRAIN
    BRAIN -->|"raw JSON proposal (untrusted)"| VAL --> GUARD
    GUARD -->|"TRIAGE"| APPROVE
    GUARD -->|"TOP_UP (clamped)"| EXEC
    GUARD -->|"child / treasury"| DEL
    DEL <--> REQ
    EXEC -->|"simulate: zero-tx plan<br/>live: payments.deposit()"| SDK
    DEL -->|"payments.deposit(amount, to)"| SDK
    LOOP --> STORE
    STORE -.->|"outbox, idempotent upsert"| SB
    LOOP --> NOTIFY
    TGL --> CONV
    DCL --> CONV
    CONV --> APPROVE
    SRV --> STORE
    SRV --> REQ
    SRV --> APPROVE
    UI --> SRV
    REQ -.->|"FOURIER_DELEGATION_URL<br/>cross-machine coordination"| SRV
```

## Decision pipeline (order is the safety model)

| # | Stage | Authority | Failure behavior |
|---|---|---|---|
| 1 | Observe (`watcher.ts`) | Synapse SDK read | Typed error, **no fabricated zeros** → no decision |
| 2 | Outcome feedback (`memory.ts`) | Deterministic | Offline-tolerant (local JSONL) |
| 3 | Propose (`brain.ts`) | **AI (untrusted)** | Provider error → HOLD with visible category |
| 4 | Validate (`decision-schema.ts`) | Deterministic | Any deviation → HOLD |
| 5 | Guardrails (`guardrails.ts`) | **Deterministic only** | Clamp / hold / require approval |
| 6 | Authorize (`approvals.ts`) | Deterministic | Unknown/expired/reused/tampered → reject |
| 7 | Execute (`executor.ts`, `delegation.ts`) | SDK | Honest `failed` status, no fabricated tx hash |
| 8 | Record (`store.ts`, `memory.ts`) | Local-first | Outbox retries; loop never blocks |
| 9 | Notify (`notifications/`) | Best-effort | Bounded retries, never crash loop |

Invariants enforced in code and covered by tests (`packages/agent/test/`):
malformed output → HOLD; top-up clamped to policy max; TRIAGE disabled by
default and approval-gated; simulation never constructs a signer or dispatches
a transaction; model/notification/store failures never stop the loop; secrets
never enter logs, events, the dashboard, or Git.

## Data ownership (self-hosted default)

| Store | Location | Content |
|---|---|---|
| Audit log | `.fourier/events.jsonl` | Full decision records + outbox state |
| Agent memory | `.fourier/memory.jsonl` | Decisions + evaluated outcomes |
| Delegation queue | `.fourier/requests.jsonl` or remote API | Child↔treasury funding requests |
| Approvals | `.fourier/approvals.json` | Single-use tokens + proposal hashes |
| Runtime | `.fourier/agent.lock`, `heartbeat.json` | Process lock, liveness |
| Config | `fourier.config.json` (gitignored) | Policy/thresholds — **no secrets** |
| Secrets | `.env` (gitignored) | Keys only; never in config or dashboard |

The Neon mirror (`core/sync.ts`) is opt-in via `FOURIER_DATABASE_URL` and only
ever *copies* data outward with idempotent upserts: the event outbox, memory
outcomes, delegation-request statuses, the policy snapshot, and the hashed
access code. The agent never reads decisions back from it.
