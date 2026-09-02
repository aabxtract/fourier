# Threat Model

Scope: the Fourier agent, its dashboard, and its chat/notification surfaces,
operated by a single self-hosting operator on Filecoin Calibration or Mainnet.

## Assets, in attack-value order

| Asset | Where it lives | Compromise impact |
|---|---|---|
| Wallet private key | `.env` (gitignored) only | Total fund loss — **never** enters config files, events, dashboard, logs, or Git |
| Model / notification / Supabase credentials | `.env` only | Spend impersonation, message spoofing, mirror write access |
| USDFC funds | Filecoin Pay contract | Bounded by guardrail caps per decision, unbounded across time |
| Decision/audit integrity | `.fourier/events.jsonl` | Silent history rewrite → cover for misbehavior |
| Approval tokens | `.fourier/approvals.json` + chat | Unauthorized TRIAGE gating decision |
| Dashboard access | localhost API | Read of decisions/memory; trigger simulations; redeem approval tokens |

## Actors and trust boundaries

| Actor | Trust level | Boundary |
|---|---|---|
| Operator | Full trust (holds keys) | Owns filesystem and `.env` |
| AI provider (Claude/OpenAI/…) | **Untrusted output** | Every response crosses the validation boundary; prompt injection via state/chat is assumed |
| Chain / Synapse SDK | Trusted for reads, slow + public | Watcher failures must never fabricate state |
| Telegram/Discord users | Untrusted unless from pinned chat ID | Listener boundary; `/approve` is deterministic |
| Dashboard clients | Untrusted network peers | API boundary: localhost by default, bearer token when exposed |
| Remote agents (`FOURIER_DELEGATION_URL`) | Semi-trusted | Delegation API boundary: token-gated, treasury-side AI evaluation + clamps still apply |

## Threats and mitigations (mapped to code + tests)

### T1 — Manipulated or hallucinated model output
**Threat:** model proposes oversized/NaN/negative top-ups, extra privileged
fields, unknown datasets, or malformed JSON to smuggle actions.
**Mitigation:** hand-rolled strict decision schema (`decision-schema.ts`) —
any deviation returns HOLD; guardrails (`guardrails.ts`) then re-check policy
independently. The model never touches execution directly.
**Tests:** `invalid model output becomes HOLD`, `top-up is clamped by code`,
parser fixtures across all actions.

### T2 — Prompt injection via chat or chain state
**Threat:** injected text in chat messages (or dataset metadata) tries to make
the agent move funds or disable safety.
**Mitigation:** the brain can only emit a structured proposal; execution
authority is deterministic (T1). `/approve` never involves the model
(`conversation.ts` short-circuits). Policy changes require file-level operator
action — no remote config mutation exists in v1.
**Tests:** `runOneCheck` pipeline tests with adversarial scenario fixtures.

### T3 — Runaway spend
**Threat:** repeated top-ups drain the wallet over time even if each one is
small.
**Mitigation:** per-decision clamp to `maxAutoTopUpUSDFC`; `topUpEnabled`
policy flag; every decision (including clamped diffs) is recorded with
proposal hash and policy version for audit.
**Tests:** clamp boundary tests; audit-record assertions.

### T4 — Approval token theft or replay
**Threat:** a leaked token is reused, or a proposal is swapped after approval.
**Mitigation:** single-use (usedAt), 10-minute expiry, SHA-256 proposal-hash
tamper check (`approvals.ts`); Telegram listener only accepts messages from
the pinned chat ID; CLI redemption path.
**Tests:** `approval token is single-use`, `approval rejects unknown and
expired tokens`.

### T5 — Dashboard exposure
**Threat:** remote attacker reads data, triggers simulations, or redeems
approval tokens via the HTTP API; XSS via stored fields.
**Mitigation:** binds `127.0.0.1` unless `FOURIER_DASHBOARD_TOKEN` is set;
when exposed, all `/api` routes require bearer auth and CORS reflects origin
only (no wildcard); all store-derived strings HTML-escaped in the SPA. The
dashboard never requests, stores, or downloads wallet keys; config served to
the client contains a public address at most.
**Tests:** manual API smoke (401 unauthenticated / 200 authenticated); XSS
escaping is unconditional in `app.js`.

### T6 — Secret leakage
**Threat:** keys committed to Git, logged, mirrored to Supabase, or embedded
in the dashboard bundle.
**Mitigation:** secrets only via `.env` (gitignored + wallet-file patterns in
`.gitignore`); events carry hashes, never raw outputs with secrets;
`syncEventOutbox` posts structured numeric/enum columns only; Supabase
service-role key is used exclusively in the server-side agent process —
the schema revokes anon/authenticated access and enables RLS.
**Residual risk (known):** `store.ts` `redact()` is currently an identity
function — event payloads contain no secret fields by construction, but a
deliberate redaction pass is future work.

### T7 — Fabricated state on watcher/RPC failure
**Threat:** an RPC outage returns zeros, which the agent would read as
"critical runway" and trigger false emergency top-ups.
**Mitigation:** watcher raises typed `WatcherError`; `runOneCheck` aborts
before the brain; no decision or execution on stale state; dashboard marks
watcher `stale` from event freshness.
**Tests:** error classification; pipeline tests assert no event on failure.

### T8 — Double execution / phantom success
**Threat:** a timed-out or failed transaction is retried into a duplicate, or
reported as success without a receipt.
**Mitigation:** executor returns honest `failed` with the concrete error and
`transactionId: null`; no automatic retry of non-idempotent onchain writes;
reconciliation is left to the operator. Simulation mode never constructs a
signer, so a logic bug cannot dispatch a transaction there.
**Tests:** `simulation has no transaction id`; live rehearsal in
`docs/calibration-evidence.md`.

### T9 — Delegation abuse (child/treasury)
**Threat:** a compromised or buggy child posts inflated funding requests; a
spoofed request is injected into the coordination API; a treasury drains
itself serving requests.
**Mitigation:** treasury-side AI evaluation checks solvency and policy, and
transfers are clamped to `maxAutoTopUpUSDFC`; requests carry the child wallet
address (transfers without one fail honestly); coordination API is
token-gated when exposed; child settles only after observing balance arrival.
**Residual risk (accepted):** any coordination-token holder can *create*
requests or *flip* statuses — fund movement still requires the treasury
agent's evaluation and clamp.

### T10 — Audit-trail tampering
**Threat:** local attacker rewrites `.fourier/events.jsonl` to hide actions.
**Mitigation:** out of scope for v1 (operator owns the host); proposal hashes
chain records to raw model outputs, and the optional Supabase mirror provides
an append-only off-host copy under RLS.

## Dependency failure matrix

| Dependency | Timeout | Retry | User-visible result | Can execute? |
|---|---|---|---|---|
| RPC / watcher | yes | bounded | `CHECK_FAILED`, dashboard `stale` | no |
| AI provider | yes | bounded | HOLD event with error category | no |
| Executor / RPC write | yes | **no auto-retry** | `failed` + reason, reconcile manually | no retry until reconciled |
| Telegram / Discord / webhook | yes | bounded, jittered | delivery warning | decision unaffected |
| Supabase mirror | yes | outbox | sync stays pending, `local-only` behavior intact | decision unaffected |
| Coordination API (remote store) | yes | per-poll | delegation poll logs failure, next poll continues | no |

## Explicit non-goals (v1)

- Natural-language configuration changes over chat (remote config mutation is
  a v2 feature requiring signed commands, previews, and rollback)
- Custody guarantees / HSM / multi-sig — the operator holds one key
- Malicious-operator protection — the operator is the trust root
- Automated dataset termination — TRIAGE only ever *recommends* a ranked
  order behind an approval token
- Multi-approver workflows and policy rollback
- Cross-chain or multi-treasury consensus

## Residual risks

1. `redact()` in `store.ts` is an identity placeholder (see T6).
2. Discord inbound uses REST polling fallback; the gateway WebSocket path is
   not implemented.
3. Chat "preference updates" mutate `USER.md`, which shapes future prompts —
   bounded by T1/T2 (guardrails stay authoritative) but noted for transparency.
4. Agent IDs are identifiers, not authorization secrets.
5. The dashboard static shell is served without auth even in token mode;
   the API — which holds all data — is not.
