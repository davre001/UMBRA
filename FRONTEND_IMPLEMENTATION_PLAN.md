# Umbra Frontend Implementation Plan

> **Production Design System & Page-by-Page Technical Specification**

## Overview

This document defines the frontend architecture, design system, routing,
page specifications, and technology stack for the Umbra Protocol
frontend.

------------------------------------------------------------------------

# Design System

## Color Palette

  Token              Value
  ------------------ -----------
  Background Base    `#08090C`
  Card / Surface     `#111319`
  Card Border        `#1E222D`
  Primary Accent     `#00F0FF`
  Secondary Accent   `#7000FF`
  Success State      `#00E5A3`
  Text Primary       `#F3F4F6`
  Text Secondary     `#8A90A6`

## Typography

-   **Navbar:** Inter (300 Light, +0.05em tracking)
-   **Page Titles:** Space Grotesk (800 Heavy Bold)
-   **Body & Labels:** Inter (300 Thin)

------------------------------------------------------------------------

# Route Alignment

  ------------------------------------------------------------------------
  Route            Page             Status                Notes
  ---------------- ---------------- --------------------- ----------------
  `/`              Landing          ✅ Aligned            Interactive ZK
                                                          proof demo

  `/portfolio`     Portfolio        🟡 Adjusted           Dual-state
                                                          balances

  `/shield`        Deposit /        ✅ Aligned            Gasless relayer
                   Withdraw                               support

  `/pay`           Private Pay      ✅ Aligned            Automated
                                                          sanctions checks

  `/swap`          Dark Swap        🟡 Adjusted           Private batch
                                                          intents & TEE
                                                          matching

  `/receive`       Receive Funds    ✅ Aligned            Stealth
                                                          addresses & QR
                                                          invoices
  ------------------------------------------------------------------------

------------------------------------------------------------------------

# Technical Specifications

## Landing (`/`)

-   Hero introduction
-   Live ZK proof simulator
-   Protocol statistics

## Portfolio (`/portfolio`)

-   Public vs Shielded balances
-   Viewing Key export
-   Anonymity score

## Shield (`/shield`)

-   Deposit interface
-   Withdraw interface
-   Gasless relayer toggle

## Private Pay (`/pay`)

-   ENS, wallet & stealth recipients
-   Background ZK sanctions verification
-   WebAuthn passkey authentication

## Dark Swap (`/swap`)

-   Encrypted order routing
-   Oracle midpoint pricing
-   Slippage & MEV controls

## Receive (`/receive`)

-   Dynamic QR generation
-   Shareable payment links
-   One-click copy

------------------------------------------------------------------------

# Technology Stack

  Layer        Technology
  ------------ -----------------------------------
  Framework    Next.js (App Router + TypeScript)
  Styling      Tailwind CSS + Framer Motion
  Blockchain   Viem, Wagmi, Soroban SDK
  ZK Engine    Noir / Circom (WASM + WebGPU)

------------------------------------------------------------------------

Generated from the Umbra Frontend Implementation Plan PDF.
