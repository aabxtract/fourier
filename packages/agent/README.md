# fourier-agent

> **Policy-constrained storage budget agent for Filecoin Onchain Cloud.**
> The AI proposes. Deterministic code disposes.

Fourier watches your Filecoin storage account, forecasts how many days of
runway remain, asks a selectable AI (Claude / OpenAI / Gemini / Grok / Groq)
for a recommendation — then a strict, deterministic rulebook validates,
clamps, gates, and executes it. Every decision is auditable.

```bash
npm install -g fourier-agent
fourier init
```

`init` then walks you through key setup interactively — wallet private key
(masked input), AI provider key, Telegram bot token with **automatic chat-id
discovery**, Discord webhook, and the Neon cloud mirror — writing everything
to `.env`. Re-run anytime with `fourier setup`.

```bash
fourier policy compile policy.txt
fourier simulate burn-spike
fourier start
```

## What it does

- **Watches** your Filecoin Pay account via the Synapse SDK — balances,
  lockup, spend rate, runway in days
- **Warns** you per your policy thresholds
- **Tops up** USDFC automatically, clamped to your configured maximum
- **Delegates** — child agents request funds, a treasury agent evaluates and
  pays via Filecoin Pay
- **Learns** — grades its own past decisions and adapts
- **Reports** — full audit trail, local dashboard, code-gated online view,
  Telegram alerts + chat (`/approve`, `/link`)

## Safety invariants

- Invalid or incomplete AI output becomes HOLD
- Top-ups are clamped to the policy maximum — in code, not in a prompt
- Simulation never constructs a signer or sends a transaction
- Dataset triage is disabled by default and approval-gated
- Secrets never enter logs, events, the dashboard, or Git

See the [monorepo README](https://github.com/aabxtract/fourier#readme) for
architecture, threat model, and the hosted-view setup (`fourier link`).

## License

MIT
