# Calibration Evidence

Live onchain verification of Fourier's Filecoin Pay integration, performed on
**Filecoin Calibration testnet** with a dedicated low-value test wallet.

Wallet: `0xAfF4faC09Ee4f69a4FceE8d9fb28bfFF7b3CEdC8` (testnet only)

## Verified capabilities

| Capability | SDK call | Result | Evidence |
|---|---|---|---|
| Account read | `payments.accountSummary()` | available/locked USDFC, lockup rate, runway in epochs | this page, live read |
| Dataset read | `storage.findDataSets()` | empty result handled cleanly | live read |
| Unit handling | — | uint256-max runway sentinel (no active spend) capped at 9999d | live read |
| Top-up deposit | `payments.deposit({ amount })` | +1.0000 USDFC credited exactly | tx below |
| Treasury-to-child transfer | `payments.deposit({ amount, to })` | child payments account credited 0.5 USDFC exactly | tx below |
| Read-only mode | address-only client | child balance verified without any signer | — |

## Transaction record

| # | Action | Tx hash | Block | Status | Balance proof |
|---|---|---|---|---|---|
| 1 | Top-up deposit — 1 USDFC into Filecoin Pay | [`0xc1a7e420212e916e4c501dea15e3d8927c4236261d85e01147fadaa1af19ef06`](https://calibration.filscan.io/en/tx/0xc1a7e420212e916e4c501dea15e3d8927c4236261d85e01147fadaa1af19ef06) | 4035041 | success | payments 9.9726 → 10.9726 USDFC; wallet 190 → 189 |
| 2 | Treasury transfer — 0.5 USDFC to child `0xA2eB885a614fE89Dc7c8199d7802fE7e90e46a54` | [`0x5c9c59028eaf2ade5cf2681a1da9c0d78ba067b243252266a584055a6659566c`](https://calibration.filscan.io/en/tx/0x5c9c59028eaf2ade5cf2681a1da9c0d78ba067b243252266a584055a6659566c) | 4035048 | success | child payments balance 0 → 0.5 USDFC (read via address-only client) |

## Zero-transaction simulation proof

`fourier simulate` against the same live state produced a full pipeline run —
real account read, model proposal (`HOLD`, correct for healthy runway), schema
validation, guardrail check, audit event — with `transactionId: null` and no
signer constructed for writes:

```json
{
  "mode": "live",
  "state": { "source": "live", "availableUSDFC": 9.9726, "runwayDays": 9999 },
  "proposal": { "action": "HOLD" },
  "guardrail": { "status": "allow" }
}
```

## Hygiene note

The test wallet's private key was handled outside version control (`.env`,
gitignored). The test wallet is single-purpose and should be discarded after
the challenge cycle.
