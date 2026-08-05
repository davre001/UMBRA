# UMBRA

> A Privacy-Preserving Dark Pool for FAssets on the Flare Network

## Overview

Umbra is a next-generation decentralized dark pool built for the **Flare
Network**. It bridges the gap between institutional-grade privacy and
regulatory compliance by combining Flare's native infrastructure with
modern cryptographic technologies.

Using **FAssets**, **Flare Time Series Oracle (FTSO)**, **Flare Data
Connector (FDC)**, and **Zero-Knowledge Proofs (ZKPs)**, Umbra enables users
to:

-   Shield token balances and trading activity
-   Execute private trades without MEV or front-running
-   Maintain AML/KYC compliance through decentralized attestations
-   Settle trades fairly using decentralized market pricing

## Problem

Public blockchains expose trading activity to everyone, making
institutional traders vulnerable to front-running, MEV attacks,
information leakage, and lack of privacy.

Traditional dark pools solve these issues but sacrifice decentralization
and transparency.

Umbra delivers the privacy of traditional dark pools while preserving
the trust assumptions of decentralized finance.

## Solution

Umbra combines Flare's ecosystem with privacy-preserving technologies: -
FAssets - Zero-Knowledge Proofs - Flare Time Series Oracle (FTSO) - Flare
Data Connector (FDC)

## Architecture

### 1. Shielded Vault

-   FAssets
-   Noir
-   Flare EVM

Users deposit public FAssets (such as FXRP or FBTC) into the Umbra smart
contract. Assets are locked while shielded balances are minted using
ZK-SNARK proofs.

### 2. Dark Engine

-   Off-chain order matcher (`backend/src/dark-engine`)
-   ZK proof-authorized settlement

Orders are private on-chain (amount and asset hidden) and matched off-chain
by a matcher that can see order details to find a counterparty, but cannot
steal or redirect funds — every settlement is authorized by a ZK proof bound
to each trader's own key, not by who submits the transaction. See
`circuits/DESIGN.md` for the full trust-boundary writeup.

### 3. Fair Pricing Engine

Uses the Flare Time Series Oracle (FTSO) for decentralized midpoint
pricing.

### 4. Compliance Layer

Uses the Flare Data Connector (FDC) to verify compliance attestations
before allowing deposits.

## Trade Lifecycle

  Phase    Action                                       Technology
  -------- -------------------------------------------- -----------------
  Screen   Compliance verification                      FDC
  Shield   Deposit FAssets and mint shielded balances   FAssets + ZK
  Order    Submit a private order commitment             Flare EVM + ZK
  Match    Match using live FTSO pricing                 FTSO + off-chain matcher
  Settle   Finalize anonymous settlement                Flare EVM + ZK

## Technology Stack

-   Node.js / TypeScript (backend)
-   Solidity (smart contracts)
-   Next.js 16 / React 19 / TypeScript (frontend)
-   Flare EVM
-   FAssets
-   FTSO
-   FDC
-   Noir (ZK circuits)

## Repository Layout

```
UMBRA/
├── backend/     # Node.js + TypeScript API (active)
├── contract/    # Solidity contracts + Noir circuits, deployed to Coston2 (active)
├── frontend/    # Next.js 16 + React 19 app (active)
└── README.md
```

All three — `backend/`, `contract/`, and `frontend/` — contain working code,
described below.

## Backend

The backend is an Express + TypeScript API that backs the flows the frontend
exercises. Each domain concern is its own module under `backend/src/`. It
talks to the real, deployed Coston2 contracts and a real live FTSOv2 feed —
there's no simulation left in the request paths below. The dark-engine's
order book and match records persist to a durable store (Turso) so they
survive a restart; everything else is in-memory and safely rebuildable
(rate lookups, compliance screening) since it holds no state that can't be
freshly re-derived.

| Module | Responsibility |
| --- | --- |
| `dark-engine` | Dark-pool order book: matches resting orders, assembles proof inputs, submits/settles on-chain |
| `pricing` | Live FTSOv2 midpoint rate lookup |
| `compliance` | Real on-chain address screening against ComplianceRegistry |
| `relayer` | Real gasless relaying — proof-authorized ShieldedVault writes submitted on a user's behalf |

### Getting Started

```bash
cd backend
npm install
npm run dev
```

The API listens on [http://localhost:4000](http://localhost:4000) (override
with `PORT` in a `.env` file — see `.env.example`). `GET /health` returns
`{"status":"ok"}` once it's up.

Other scripts (run from `backend/`):

```bash
npm run build   # type-check and compile to dist/
npm run start   # run the compiled build
npm test        # run the vitest suite (supertest against every route)
```

## Frontend

The frontend is a [Next.js](https://nextjs.org) 16 (App Router) application
using React 19, TypeScript, and Tailwind CSS v4, with `wagmi` / `viem` for
wallet connectivity, `@tanstack/react-query` for data fetching, `framer-motion`
for animation, and a `three.js`-based WebGL background.

Current pages under `frontend/src/app/`:

-   `/` — landing / entry into the protocol vault
-   `/portfolio` — portfolio dashboard
-   `/shield` — shield assets (deposit FAssets into shielded balances)
-   `/pay` — private pay (send, and claim incoming stealth payments)
-   `/swap` — dark swap (private trading; also where residual/partial-fill orders are claimed)
-   `/faucet` — deep-links to Flare's Coston2 faucet for testnet assets

### Getting Started

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app. Pages
auto-update as files under `frontend/src` are edited.

Other scripts (run from `frontend/`):

```bash
npm run build   # production build
npm run start   # run the production build
npm run lint     # lint the codebase
```

## Vision

Build the institutional liquidity layer for the Flare ecosystem with
private, compliant, and decentralized trading infrastructure.
