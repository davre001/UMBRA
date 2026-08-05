# Umbra

**A privacy-preserving dark pool for FAssets on the Flare Network.**

[![Backend CI/CD](https://github.com/davre001/UMBRA/actions/workflows/backend-ci-cd.yml/badge.svg)](https://github.com/davre001/UMBRA/actions/workflows/backend-ci-cd.yml)
[![Docs](https://img.shields.io/badge/docs-umbra-blueviolet)](https://docs-umbra.vercel.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Public blockchains publish every trade — what you hold, what you traded, and
who you traded with. That's exactly the information that makes front-running
and MEV extraction possible. Umbra keeps balances, orders, and counterparties
private, while proving in zero knowledge — verifiable by anyone — that every
settlement followed the rules.

📖 **Full documentation:** [docs-umbra.vercel.app](https://docs-umbra.vercel.app/)

---

## Contents

- [What stays private](#what-stays-private)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Backend](#backend)
- [Frontend](#frontend)
- [Status](#status)
- [License](#license)

## What stays private

| | Amount | Asset | Counterparty |
| --- | --- | --- | --- |
| **Shield** (deposit) | Public | Public | — |
| **Dark pool order** | Private | Private | Private |
| **Private pay** | Private | Public | Private |
| **Withdraw** | Public | Public | Public |

Depositing into the vault is a public ERC-20 transfer — there's nothing secret
about putting money in. Everything you do *inside* the vault is private, and
what you reveal on the way out depends on which exit you take. Dark pool
orders are the strongest case: amounts **and** assets stay hidden, with only
an opaque commitment and a nullifier ever going on-chain.

## How it works

1. **Shield** — deposit tokens into `ShieldedVault`. A commitment to your new
   note is inserted as a leaf in an on-chain Merkle tree. No proof is needed
   yet; you're publishing a commitment, not spending one.
2. **Trade** — place an order by spending a note and inserting an opaque order
   commitment in its place. Orders rest off-chain in the dark engine's book.
   A matcher pairs compatible orders and generates a zero-knowledge proof
   that the match was computed correctly.
3. **Exit** — settle to a new shielded note, pay someone privately, or
   withdraw publicly to an address.

Matching happens off-chain, but correctness isn't a matter of trust: the
`match_orders` circuit proves the fill respected both traders' limits, and a
Solidity verifier checks that proof on-chain before the vault moves anything.
A dishonest matcher cannot produce a valid proof for an invalid match. See
[`circuits/DESIGN.md`](./contract/circuits/DESIGN.md) for the full
trust-boundary writeup, or the [Concepts docs](https://docs-umbra.vercel.app/concepts/dark-pool)
for the guided version.

**Built on:**

| | |
| --- | --- |
| Chain | Flare (Coston2 testnet) |
| ZK circuits | [Noir](https://noir-lang.org/), compiled to WASM, proven client-side with Barretenberg |
| Pricing | Flare Time Series Oracle (FTSOv2) |
| Compliance | Flare Data Connector (FDC) — on-chain address screening |
| Assets | FAssets (FXRP, and more) |

## Repository layout

```
umbra/
├── backend/     # Express + TypeScript API — dark-engine matcher, pricing, compliance, relayer
├── contract/    # Solidity contracts + Noir circuits, deployed to Coston2
├── frontend/    # Next.js 16 + React 19 app
└── docs/        # Nextra docs site — docs-umbra.vercel.app
```

## Quick start

You'll need Node.js and a wallet with Coston2 testnet funds (use the app's
faucet page once it's running, or [Flare's own faucet](https://faucet.flare.network/)).

```bash
# Backend — the dark-engine matcher, pricing, compliance, and relayer API
cd backend && npm install && npm run dev   # → http://localhost:4000

# Frontend — the app itself
cd frontend && npm install && npm run dev  # → http://localhost:3000
```

Full setup, wallet connection, and your first shielded deposit are walked
through in [Getting Started](https://docs-umbra.vercel.app/getting-started).

## Backend

An Express + TypeScript API backing every flow the frontend exercises. It
talks to the real, deployed Coston2 contracts and a live FTSOv2 feed — no
simulation in the request paths. The dark-engine's order book and match
records persist to a durable store (Turso) so they survive a restart;
everything else is in-memory and safely rebuildable, holding no state that
can't be freshly re-derived.

| Module | Responsibility |
| --- | --- |
| `dark-engine` | Order book: matches resting orders, assembles proof inputs, submits/settles on-chain |
| `pricing` | Live FTSOv2 midpoint rate lookup |
| `compliance` | Real on-chain address screening against `ComplianceRegistry` |
| `relayer` | Real gasless relaying — proof-authorized `ShieldedVault` writes submitted on a user's behalf |

```bash
cd backend
npm run build   # type-check and compile to dist/
npm run start   # run the compiled build
npm test        # vitest suite (supertest against every route)
```

`GET /health` returns `{"status":"ok"}` once it's up; interactive API docs
are served at `/docs` (Swagger UI). See `.env.example` for required
environment variables.

## Frontend

A [Next.js](https://nextjs.org) 16 (App Router) app using React 19,
TypeScript, and Tailwind CSS v4, with `wagmi` / `viem` for wallet
connectivity, `@tanstack/react-query` for data fetching, and `framer-motion`
for animation.

| Route | Purpose |
| --- | --- |
| `/` | Landing / entry into the protocol |
| `/portfolio` | Portfolio dashboard |
| `/shield` | Deposit FAssets into shielded balances |
| `/pay` | Private pay — send, register your payment key, claim incoming payments |
| `/swap` | Dark pool trading — place, cancel, and claim orders |
| `/faucet` | Deep-links to Flare's Coston2 faucet for testnet assets |

```bash
cd frontend
npm run build   # production build
npm run start   # run the production build
npm run lint    # lint the codebase
```

## Status

Umbra runs on the **Flare Coston2 testnet** — no real funds are at risk. See
[Deployed Contracts](https://docs-umbra.vercel.app/reference/contracts) for
live addresses, and [Getting Started](https://docs-umbra.vercel.app/getting-started)
to make your first shielded deposit.

## License

MIT — see [LICENSE](./LICENSE). Courtesy of the Hacknest Team (Web3Nova).
