# UMBRA

> A Privacy-Preserving Dark Pool for FAssets on the Flare Network

## Overview

Umbra is a next-generation decentralized dark pool built for the **Flare
Network**. It bridges the gap between institutional-grade privacy and
regulatory compliance by combining Flare's native infrastructure with
modern cryptographic technologies.

Using **FAssets**, **Flare Time Series Oracle (FTSO)**, **Flare Data
Connector (FDC)**, **Zero-Knowledge Proofs (ZKPs)**, and **Trusted
Execution Environments (TEEs)**, Umbra enables users to:

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
FAssets - Zero-Knowledge Proofs - Trusted Execution Environments
(TEEs) - Flare Time Series Oracle (FTSO) - Flare Data Connector (FDC)

## Architecture

### 1. Shielded Vault

-   FAssets
-   Noir / Circom
-   Flare EVM

Users deposit public FAssets (such as FXRP or FBTC) into the Umbra smart
contract. Assets are locked while shielded balances are minted using
ZK-SNARK proofs.

### 2. Dark Engine

-   Google Cloud Confidential Space
-   Trusted Execution Environments (TEE)

Encrypted trade intents are matched securely inside a TEE to prevent MEV
and front-running before submitting cryptographic proofs back to Flare.

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
  Order    Submit encrypted order                       Flare EVM + TEE
  Match    Match using decentralized pricing            FTSO + TEE
  Settle   Finalize anonymous settlement                Flare EVM

## Technology Stack

-   Node.js / TypeScript (backend)
-   Solidity (smart contracts)
-   Next.js 16 / React 19 / TypeScript (frontend)
-   Flare EVM
-   FAssets
-   FTSO
-   FDC
-   Noir / Circom
-   Google Cloud Confidential Space

## Repository Layout

```
UMBRA/
├── backend/     # Node.js + TypeScript API (active)
├── contract/    # Solidity smart contracts (scaffolded, not yet implemented)
├── frontend/    # Next.js 16 + React 19 app (active)
└── README.md
```

`contract/` is currently an empty placeholder folder reserved for the
on-chain Solidity contracts. `backend/` and `frontend/` both contain working
code, described below.

## Backend

The backend is an Express + TypeScript API that backs the flows the frontend
exercises. Each domain concern is its own module under `backend/src/`, and
each module talks over in-memory state — there's no database, real Flare
node, ZK circuit, or TEE wired up yet, so behavior (proof bytes, relay hashes,
oracle rates, sanction screens) is simulated rather than cryptographically
real. That keeps the API contract stable while the underlying primitives
(Noir circuits, TEE matcher, live FTSO/FDC clients) are built out.

| Module | Responsibility |
| --- | --- |
| `vault` | Shielded balances: shield, withdraw, private pay (in-memory per address) |
| `portfolio` | Aggregates vault balances into net worth, allocation, and history |
| `dark-engine` | Swap intents: routes, matches, and settles against a midpoint rate |
| `pricing` | FTSO-style midpoint rate lookup |
| `compliance` | FDC-style sanction screening and compliance viewing-key export |
| `stealth` | One-time stealth address derivation and recipient resolution |
| `prover` | Simulated Noir witness/proof generation |
| `relayer` | Simulated gasless transaction relaying |
| `auth` | WebAuthn-style passkey challenge/verify |

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
-   `/pay` — private pay (stealth payments)
-   `/swap` — dark swap (private trading)
-   `/receive` — receive funds

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
