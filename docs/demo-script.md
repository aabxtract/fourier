# Fourier — Demo Plan & Script

Target length: **4–5 minutes** (a 3-minute cut is marked). Rehearse three
times; keep a prerecorded backup of the full run.

---

## Pre-flight checklist (do BEFORE recording)

1. **Fresh folder, published package**
   ```bash
   mkdir fourier-demo && cd fourier-demo
   npx fourier-agent init
   ```
   Complete the interactive setup on camera or beforehand:
   - wallet private key (paste — input is masked)
   - AI provider key (or skip → canned reasoning)
   - Telegram bot token → **send the bot any message** → chat id auto-discovered
   - Neon connection string + view URL → phone view + cloud mirror live
2. **Wallet funded:** testnet FIL (gas) + USDFC from the faucet.
3. **Policy compiled:** `fourier policy compile policy.txt` (the sample is fine).
4. **Sanity check:** `fourier simulate` → output must say `"source": "live"`.
5. **Phone ready:** open `https://fourier-view.vercel.app?code=<your code>`,
   Telegram app logged in, filscan open in a phone tab.
6. **Clean terminal** (`cls`), font size up, recording at 1080p+.
7. **Offline fallback:** a second terminal where `fourier simulate burn-spike`
   already works without network (scenarios run on deterministic fixtures).

---

## The script

### Beat 1 — The problem (0:00–0:30)
> "On Filecoin Onchain Cloud, storage providers pull USDFC from your balance
> continuously. If it hits zero, your storage rails run dry — silently. A
> balance snapshot says 9.8 days. Accelerating spend says 2.1. Humans don't
> watch that. **Fourier does.**"

### Beat 2 — English becomes a rulebook (0:30–1:00)
```bash
notepad policy.txt        # show the 3 plain-English lines
fourier policy compile policy.txt
```
> "My policy in plain English — compiled into a versioned rulebook. I review
> it here: warn at 7 days, act at 3, cap top-ups at 5 USDFC, preserve order.
> **This compiled object — not my prose — is what the guardrails enforce.**"

### Beat 3 — Zero-risk power (1:00–1:45)
```bash
fourier simulate burn-spike
```
> "Full pipeline, zero transactions guaranteed. Watch: naive projection 9.8
> days… history-aware projection 2.1 — the burn is accelerating. The AI
> proposes 7.5 USDFC — and the deterministic guardrail **clamps it to my cap
> of 5**. `transactionId: null` — real chain reads, holstered hands."

### Beat 4 — Human in the loop (1:45–2:30)
```bash
fourier simulate budget-squeeze
```
> "Funds almost gone. Fourier ranks datasets by my policy priority and
> **gates** the triage behind a single-use, 10-minute, tamper-checked token."
```bash
fourier approve <token>
```
> "Approved. Reuse it, wait 10 minutes, or tamper with the proposal — the
> token refuses. *(Optional wow: `fourier start` in a second terminal, then
> send `/approve <token>` from Telegram on your phone.)*"

### Beat 5 — Swap the brain (2:30–3:00)
```bash
fourier use groq
fourier simulate burn-spike
```
> "Different provider entirely — the phrasing changes. The schema, the clamp,
> the approval gate, the zero-transaction guarantee **do not**."

### Beat 6 — The autonomous agent, LIVE (3:00–4:15)
```bash
fourier start
```
> "Now the real thing. Live on Calibration: real balance read — source live.
> Healthy wallet, so it correctly holds and checks again in 30 minutes."

**Variant A (safe):** show the Telegram push arriving on the phone, then the
live view chart updating at fourier-view.vercel.app — every decision mirrored.

**Variant B (the onchain receipt):** before recording, compile the demo
policy *aggressively* (thresholds above the 9999-day sentinel, cap 2 USDFC):
```text
Warn me below 15000 days of runway. Below 12000 days, top up at most 2 USDFC.
```
The agent fires a **real Filecoin Pay top-up on camera** — open the tx hash on
filscan (phone) and show the payments balance rise. Say:
> "That was the agent deciding and moving real testnet USDFC onchain — within
> the cap I set, with a full audit record. That's autonomy with a leash."

### Beat 7 — Close (4:15–4:35)
> "Everything you saw is one command on any machine — `npx fourier-agent
> init` — open source, self-hosted, with the threat model written down.
> Fourier: the AI proposes. Deterministic code disposes."

---

## 3-minute cut

Beats 1 → 3 → 6 (Variant B) → 7. Drop the policy-compile reading (say it in
one line over the simulate output), drop Beat 5.

## Failure fallbacks (know these cold)

| Fails on stage | You do |
|---|---|
| Chain/RPC read | Scenarios still run offline (fixtures) — say "deterministic mode, same pipeline" |
| AI provider down | Canned reasoning appears — "the decision layer doesn't depend on the provider" |
| Telegram not configured | Approve via CLI — same token mechanics |
| Neon/view not syncing | Show the local dashboard instead — same data, localhost |
| Anything unfixable | Switch to the prerecorded backup |
