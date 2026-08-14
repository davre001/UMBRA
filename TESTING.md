# Testing Umbra — Guide & Automated Verification

This document covers both the **Automated Developer/Auditor Verification Suite** and the **Manual Live App Testing Walkthrough**.

---

## 🔬 Automated Testing & Verification Suite

Umbra includes **155 smart contract tests** (covering unit testing, property invariants, and negative ZK proof verification) and **59 backend integration tests**.

### Automated Test Matrix

| Category | Command | Tests | Scope & Invariants Tested |
| :--- | :--- | :--- | :--- |
| **All Monorepo Tests** | `pnpm test` | **214 passing** | Contract suites + backend API integration suites |
| **Smart Contracts** | `pnpm contracts:test` | **155 passing** | Core vault lifecycle, access-control bypasses, boundary conditions |
| **Contract Coverage** | `pnpm contracts:coverage` | **91.75% lines** | `solidity-coverage` report (100% on all registries & forwarders) |
| **ZK Negative Tests** | `pnpm --filter umbra-contracts test test/Verifiers.negative.test.ts` | **78 passing** | Corrupted proofs, bit flips, truncation, 0x/0xFF payloads, field overflow |
| **Invariant Fuzzing** | `pnpm --filter umbra-contracts test test/ShieldedVault.invariants.test.ts` | **6 passing** | Solvency conservation, strict double-spend prevention, compliance gate |
| **Backend & SPV** | `pnpm backend:coverage` | **59 passing** | SegWit tx serialization, Merkle inclusion proofs, FTSOv2 price feeds |
| **CI Verification** | `pnpm typecheck && pnpm lint && pnpm build` | All 6 pkgs | Full TypeScript check, ESLint, and Next.js / Hardhat compilation |

---

## 📱 Manual Live App Walkthrough

No coding knowledge needed — just a browser, a wallet, and some free test tokens.

**App (frontend):** https://umbra-flare.vercel.app/
**Backend (API):** https://umbra-backend-qi2g.onrender.com

Everything here uses **Coston2**, which is a free test network for Flare — nothing is real money, so don't worry about breaking anything.

---

## Before you start

- Install a wallet browser extension if you don't have one — **MetaMask**
  is the easiest.
- Add the **Coston2** network to your wallet (search "Flare Coston2" in
  MetaMask's network list, or add it manually — network ID `114`).
- If you want to test sending money to someone else (the Pay and Swap
  pages), it helps to have a second wallet address. You can create a
  second account inside MetaMask for this — you don't need a second
  computer.

---

## Step 1 — Open the app and connect your wallet

1. Go to **https://umbra-flare.vercel.app/**
2. Click **Connect Wallet** and choose MetaMask (or whichever wallet you
   use). Approve the connection when your wallet pops up.
3. Make sure your wallet is switched to the **Coston2** network. The app
   has a network switcher in the top bar if you need to change it.
4. The first time you do anything with your shielded balance, your wallet
   will ask you to **sign a message**. This is not a payment and costs no
   gas — it's just proving you own the wallet. Go ahead and sign it.
5. Refresh the page. You should still be logged in — you shouldn't have to
   reconnect every time.

### Quick check — disconnecting works properly

1. Click **Disconnect** and confirm.
2. You should be sent back to the start page with a "Wallet Disconnected"
   message.
3. This is expected either way: clicking **Connect** again right after
   might log you back in without asking you to pick a wallet again — that's
   normal wallet behavior, not a bug. What matters is that the app itself
   treats you as logged out until you connect again.

---

## Step 2 — Get free test tokens

1. Go to the **Faucet** page.
2. You'll see three tokens: `C2FLR`, `FXRP`, and `USDT0`. Click through to
   claim some of each from Flare's official faucet links.
3. Come back to the Faucet page after claiming — your balance should
   update on its own, no refresh needed.
4. Grab a decent amount of all three so you have enough to test shielding,
   paying, and swapping without running out.

---

## Step 2b — Bridge in real Bitcoin (optional, slower)

This one uses **real signet Bitcoin** — a public Bitcoin test network, not
simulated. It's genuinely free (signet coins have zero value), but it's
also genuinely slower than the other three assets, since it waits on real
Bitcoin block times.

1. On the **Faucet** page, find the BTC card. It auto-derives a signet
   deposit address for your connected wallet — no separate wallet or
   "Derive" step needed.
2. Click **Signet Faucet** to open an external signet faucet, and paste in
   your derived address (shown on the BTC card, with a copy button).
   Request some coins.
3. Wait for your funding transaction to confirm on signet — usually around
   10 minutes, but real Bitcoin block times vary and can occasionally run
   much longer. You don't need to do anything during this wait.
4. Once confirmed, the app **automatically** builds, signs, and broadcasts
   the deposit transaction — no click needed. You'll see the card's status
   change to "Depositing…" on its own the next time the page polls (every
   few seconds) if you're watching, or you can just come back later.
5. **Heads up — minting can be slow or need a nudge right now.** After the
   deposit transaction itself confirms, it needs one more manual step
   (an admin "checkpoint refresh") before it's actually provable — this is
   a known, disclosed current limitation, not a bug (see the root
   [README's Bitcoin bridge section](./README.md#bitcoin-bridge)). If your
   BTC balance doesn't show up in Portfolio within an hour or so of the
   deposit tx confirming, that's expected right now, not something you did
   wrong.
6. If you ever close the tab partway through, that's safe — a backend
   watcher independently notices real deposits paid to the vault and
   registers them even if your browser never got the chance to.

---

## Step 3 — Shield some funds (make them private)

"Shielding" means moving your public tokens into Umbra's private vault.

1. Go to **Shield** → the **Deposit** tab.
2. Pick `C2FLR` first (it's the simplest one to test).
3. Enter a small amount and confirm. Approve the transaction in your
   wallet when asked.
4. Watch the progress steps on screen until it says **Settlement /
   Completed**.
5. **Double-check it actually worked:** click the transaction link shown
   after it finishes, which opens the
   [Coston2 explorer](https://coston2-explorer.flare.network/). The
   transaction status there should say **Success**. If the app says
   "success" but the explorer disagrees, that's a real bug worth
   reporting.
6. Try shielding `FXRP` or `USDT0` too — these need one extra "Approve"
   step before the deposit itself, which is normal for these token types.
7. Go to **Portfolio** and confirm your **Shielded** balance went up (and
   your **Public** balance went down) by the right amount — you shouldn't
   need to reload the page to see it update.

### Bonus check — recovering deposits on a new device

If you ever open Umbra on a different browser or device with the same
wallet, your shielded deposits aren't lost. On the Shield page, there's a
**Recover Deposits** button — it scans the blockchain and finds your past
deposits automatically. Try it in a private/incognito window to confirm it
works.

---

## Step 4 — Withdraw funds back to public

Withdrawing takes money out of the private vault and sends it to a
public wallet address.

1. Go to **Shield** → the **Withdraw** tab.
2. Pick one of your shielded notes and enter a destination address (your
   own wallet, or any address you control for testing).
3. You'll notice a small label near the address field showing whether it's
   **"Screened Clear"** or **"Not Yet Screened"**. This is Umbra's
   compliance check (a placeholder for real sanctions screening) — every
   withdrawal destination needs to pass this check before funds can be
   sent to it. If it's not screened yet, don't worry — the app now does
   this automatically as part of the withdrawal, you'll just see an extra
   "Verifying compliance status" step.
4. Confirm the withdrawal and watch it complete.
5. **Double-check on the explorer again** — the transaction should say
   **Success**. Then check **Portfolio** — the note you withdrew should no
   longer count toward your shielded balance.
6. If you have more than one shielded note for an asset, try **Unshield
   All** instead — it withdraws every note for that asset in one click
   (each one is still its own transaction under the hood, so it may ask
   your wallet to approve more than once).

### Why this matters

We previously had a bug where the app could say "Successfully withdrew"
even when the transaction actually failed on the blockchain. That's now
fixed — the app checks the real result of every transaction before
declaring success. If you ever see the app say "success" but the explorer
link shows the transaction failed, that's exactly the kind of thing we
want to know about.

---

## Step 5 — Register to receive private payments

Before anyone can pay you privately, you need to publish a "payment key"
once.

1. Go to **Receive**.
2. Click **Register**. Approve the transaction. Confirm the page now shows
   you as registered.

---

## Step 6 — Send a private payment

This works best with two wallet addresses — think of it as Wallet A paying
Wallet B.

1. On **Wallet B**, make sure it's registered (Step 5).
2. On **Wallet A**, go to **Pay**, enter Wallet B's address. The app should
   confirm B is registered before letting you continue.
3. Pick a shielded note and confirm the payment. This involves two
   transactions behind the scenes — wait for both to finish.
4. Switch to **Wallet B**, go to **Receive**, and check the **Incoming**
   list — the payment should show up there. Click **Claim** to add it to
   B's shielded balance.
5. Confirm B's Portfolio balance goes up, and A's goes down, by the right
   amount.

---

## Step 7 — Try a private swap

The Swap page lets you place a private trade order (e.g. "I want to trade
my FXRP for USDT0").

1. Go to **Swap**, pick a note to sell, what you want in return, and the
   minimum amount you'd accept.
2. Confirm the order. Once it's on-chain, it's real — even if the message
   about notifying the matching engine fails, your order isn't lost, it
   just might need resubmitting to be matched.
3. Matching two opposite orders together requires a separate matching
   service to be running, so don't expect an instant fill during casual
   testing — this part is more relevant for a full end-to-end test with
   another tester.
4. Try **cancelling** an order you placed instead — confirm it disappears
   from your open orders and comes back to you as a regular shielded note.

---

## Things to watch out for while testing

- **Trust the blockchain explorer over the app's own success message.**
  If they ever disagree, that's a bug worth reporting.
- **Two tabs open with the same wallet:** if you spend a note in one tab,
  the other tab's Portfolio page won't update by itself — you'll need to
  refresh that tab. This is a known limitation, not something newly
  broken.
- **The backend "waking up":** the first request after a while of
  inactivity can be slow (see the note at the top). Give it a moment
  before assuming something failed.

---

## Quick checklist

- [ ] Connect wallet → land inside the app
- [ ] Disconnect → returned to start screen
- [ ] Claim free tokens from the Faucet
- [ ] (optional) Fund your derived signet address → deposit auto-broadcasts with no click once confirmed
- [ ] Shield a deposit → shows Success on the explorer
- [ ] Portfolio balance updates without reloading
- [ ] Withdraw to a fresh address → gets screened automatically, succeeds
- [ ] Withdraw shows Success on the explorer (matches what the app says)
- [ ] Register on Receive
- [ ] Pay another wallet → they can see and claim it
- [ ] Place and cancel a Swap order
