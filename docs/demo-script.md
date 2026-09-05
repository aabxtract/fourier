# Fourier — Demo Plan & Script (FINAL · v1.1.0)

Length: **4:30–5:00** · Variant: **B (real onchain top-up on camera)**
Rehearse 3×. Keep a prerecorded backup of the full run.

---

## Pre-flight (before recording — nothing improvised)

1. **Global install first** (so bare `fourier` commands work all demo long):
   ```bash
   npm install -g fourier-agent
   ```
2. **Fresh demo folder** (this IS the user story — installing on camera):
   ```bash
   mkdir fourier-demo && cd fourier-demo
   fourier init
   ```
2. **Values ready to paste during setup:**
   - Calibration test wallet private key (from `Desktop\Fourier\.env.backup`) — wallet must have testnet FIL (gas) + USDFC (faucet)
   - AI provider key (or Enter to skip → canned reasoning)
   - Telegram bot token (from BotFather) — **phone within reach**: you'll send the bot a message so chat-id discovery fires on camera
   - Neon connection string (from `.env.backup`) — the schema is already applied, nothing else needed
   - View URL: press Enter (defaults to fourier-view.vercel.app)
3. **Compile the DEMO policy** (aggressive, for Beat 6's real top-up):
   ```text
   Warn me below 15000 days of runway. Below 12000 days, top up at most 2 USDFC.
   ```
   `fourier policy compile policy.txt`
4. **Sanity check:** `fourier simulate` → must show `"source": "live"` and your real balances.
5. **`fourier link`** → copy the new access code → open `https://fourier-view.vercel.app?code=<new code>` on the phone → verify data appears (run `fourier start` once briefly, Ctrl+C).
6. **Phone ready:** Telegram app open at your bot chat, filscan tab open, live view tab open.
7. Clean terminal (`cls`), big font, 1080p+, mic level checked.

---

## The script

### Beat 1 — Install + keys on camera (0:00–0:45)
> "This is a brand-new install — what a stranger would run."
```bash
npx fourier-agent init
```
Walk the prompts: paste the wallet key (**input masked — say: "the key never echoes, never leaves this machine"**), skip or paste AI key, paste the Telegram bot token — **send the bot a message from the phone** — chat id discovered automatically: *"it found my chat id by itself. No manual lookup."* Paste the Neon string. Enter for the view URL.

### Beat 2 — The problem (0:45–1:10)
> "On Filecoin Onchain Cloud, storage providers pull USDFC from your balance continuously. If it hits zero, your storage rails die — silently. A balance snapshot says 9.8 days. Accelerating spend says 2.1. Humans don't watch that. Fourier does."

### Beat 3 — English → rulebook (1:10–1:40)
```bash
notepad policy.txt        # show the 2 demo lines
fourier policy compile policy.txt
```
> "Plain English in — a versioned rulebook out, which I review before it's
> enforced. This compiled object, not my prose, is what the guardrails obey.
> Note the thresholds — I've set them high on purpose. You'll see why."

### Beat 4 — Zero-risk power (1:40–2:20)
```bash
fourier simulate burn-spike
```
> "Full pipeline, zero transactions, guaranteed. Naive projection: 9.8 days.
> History-aware: 2.1 — the burn is accelerating. The AI proposes 7.5 USDFC —
> the deterministic guardrail clamps it to my 2 USDFC cap. `transactionId:
> null` — real chain reads, holstered hands."

### Beat 5 — Human in the loop (2:20–2:55)
```bash
fourier simulate budget-squeeze
```
> "Funds nearly gone — Fourier ranks my datasets by policy priority and gates
> the triage behind a single-use, 10-minute, tamper-checked token."
```bash
fourier approve <token>
```
> "Approved once. Reuse it, wait it out, or tamper — it refuses."

### Beat 6 — The autonomous agent, LIVE (2:55–4:15) — VARIANT B
```bash
fourier start
```
> "The real agent, live on Calibration. First cycle: real account read —
> source live. Runway 9,999 days… but my policy says act below 12,000 —
> so it acts."
- **Terminal:** AI proposal → guardrail → `payments.deposit` broadcast → **tx hash**
- **Phone 1 (Telegram):** push notification arrives — shows the decision + live-view link
- **Phone 2 (filscan):** open the hash — status success
- **Phone 3 (live view):** the chart/decision feed updated
> "That was the agent deciding and moving real testnet USDFC — within the cap
> I set, with a full audit record. Autonomy with a leash."
`Ctrl+C` to stop (graceful drain).

### Beat 7 — Close (4:15–4:40)
> "Everything you just saw is one command on any machine — `npx fourier-agent
> init`. Open source, self-hosted, your own database, your own access code.
> The AI proposes. Deterministic code disposes."

---

## 3-minute cut

Beats 1 (sped up — setup done beforehand, show only the summary) → 4 → 6 → 7.

## Fallbacks

| Breaks | Do |
|---|---|
| Chain read fails | Run a named scenario — "deterministic mode, same pipeline" (offline fixtures) |
| AI provider down | Canned reasoning appears — "the decision layer doesn't depend on the provider" |
| Chat-id discovery finds nothing | Send the message, press retry; worst case approve via CLI |
| Deposit hangs | Say "broadcast sent, finality takes ~30s epochs" and show the hash in filscan pending |
| Anything unrecoverable | Switch to the prerecorded backup |

## After the take

- Revert the policy to sane defaults (7/3/5): `notepad policy.txt` → recompile
- Optionally `fourier link --rotate` so only the demo code stays valid
- Grab the tx hash → append to `docs/calibration-evidence.md` as agent-initiated
