# Umbra

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

-   Flare EVM
-   FAssets
-   FTSO
-   FDC
-   Noir / Circom
-   Google Cloud Confidential Space

## Vision

Build the institutional liquidity layer for the Flare ecosystem with
private, compliant, and decentralized trading infrastructure.
