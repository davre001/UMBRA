export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "UMBRA API",
    version: "0.1.0",
    description: "Local reference for the UMBRA backend endpoints.",
  },
  servers: [{ url: "http://localhost:4000" }],
  tags: [
    { name: "Health" },
    { name: "Dark Engine" },
    { name: "Pricing" },
    { name: "Compliance" },
    { name: "Relayer" },
    { name: "BTC Deposit" },
    { name: "BTC Withdrawal" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Liveness check",
        responses: {
          "200": {
            description: "Service is up",
            content: {
              "application/json": {
                schema: { type: "object", properties: { status: { type: "string", example: "ok" } } },
              },
            },
          },
        },
      },
    },
    "/api/dark-engine/orders": {
      post: {
        tags: ["Dark Engine"],
        summary: "Submit a dark-pool order intent (after placeOrder confirms on-chain)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "commitment",
                  "leafIndex",
                  "nullifier",
                  "secret",
                  "amountIn",
                  "assetIn",
                  "assetOut",
                  "minAmountOut",
                  "ownerKey",
                  "walletAddress",
                ],
                properties: {
                  commitment: { type: "string", description: "order_commitment, as inserted on-chain" },
                  leafIndex: { type: "integer", description: "Leaf index from the OrderPlaced event" },
                  nullifier: { type: "string" },
                  secret: { type: "string" },
                  amountIn: { type: "string" },
                  assetIn: { type: "integer" },
                  assetOut: { type: "integer" },
                  minAmountOut: { type: "string" },
                  ownerKey: { type: "string", description: "Trader's own published ownerKey — the matched output note is credited here" },
                  walletAddress: { type: "string", description: "Where to deliver the matched note via StealthAnnouncer" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Order rests on the book, or matched immediately (status: 'resting' | 'matched')" },
          "400": { description: "Invalid order intent" },
        },
      },
      get: {
        tags: ["Dark Engine"],
        summary: "List open orders (commitments + timestamps only, never order details)",
        responses: { "200": { description: "Open order book" } },
      },
    },
    "/api/dark-engine/matches": {
      get: {
        tags: ["Dark Engine"],
        summary: "List matches (status only)",
        responses: { "200": { description: "Matches" } },
      },
    },
    "/api/dark-engine/matches/{id}": {
      get: {
        tags: ["Dark Engine"],
        summary: "Get a match's status",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Match status" },
          "404": { description: "Match not found" },
        },
      },
    },
    "/api/dark-engine/matches/{id}/proof": {
      post: {
        tags: ["Dark Engine"],
        summary: "Submit an externally-generated match_orders proof to complete a pending match",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["proof"], properties: { proof: { type: "string" } } },
            },
          },
        },
        responses: {
          "200": { description: "Match submitted on-chain and both output notes announced" },
          "400": { description: "Missing/invalid proof" },
        },
      },
    },
    "/api/pricing": {
      get: {
        tags: ["Pricing"],
        summary: "Real FTSOv2 USD prices for every supported asset",
        responses: { "200": { description: "USD prices" } },
      },
    },
    "/api/pricing/{fromAsset}/{toAsset}": {
      get: {
        tags: ["Pricing"],
        summary: "Real FTSOv2 midpoint exchange rate between two supported assets",
        parameters: [
          { name: "fromAsset", in: "path", required: true, schema: { type: "string" } },
          { name: "toAsset", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Rate for the asset pair" },
          "400": { description: "Unsupported asset" },
        },
      },
    },
    "/api/compliance/screen": {
      post: {
        tags: ["Compliance"],
        summary: "Screen an address and record the result on-chain via ComplianceRegistry (ATTESTER_ROLE)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address"],
                properties: { address: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Screening result + tx hash" },
          "400": { description: "Invalid address" },
        },
      },
    },
    "/api/compliance/{address}": {
      get: {
        tags: ["Compliance"],
        summary: "Real on-chain screening status for an address",
        parameters: [{ name: "address", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Screening status" } },
      },
    },
    "/api/relayer/relay": {
      post: {
        tags: ["Relayer"],
        summary: "Relay a pre-proven ShieldedVault action gaslessly (proof = authorization, no signature needed)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action", "args"],
                properties: {
                  action: { type: "string", enum: ["withdraw", "pay", "placeOrder", "cancelOrder", "depositExternal"] },
                  args: { type: "array", items: {}, description: "Positional args matching the vault function's signature" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Relay transaction hash" },
          "400": { description: "Unknown action or wrong argument count" },
        },
      },
    },
    "/api/btc-deposit/submit": {
      post: {
        tags: ["BTC Deposit"],
        summary: "Submit a confirmed BTC signet deposit tx (fixed OP_RETURN+P2WPKH template) for proving",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["txid", "blinding"], properties: { txid: { type: "string" }, blinding: { type: "string" } } },
            },
          },
        },
        responses: {
          "201": { description: "Deposit accepted, queued awaiting_proof" },
          "400": { description: "Invalid txid/blinding or template mismatch" },
        },
      },
    },
    "/api/btc-deposit/{id}": {
      get: {
        tags: ["BTC Deposit"],
        summary: "Get a submitted BTC deposit's proving status",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Deposit status" }, "404": { description: "Not found" } },
      },
    },
    "/api/btc-withdrawal/{nullifierHash}": {
      get: {
        tags: ["BTC Withdrawal"],
        summary: "Get an observed BTC withdrawal request's fulfillment status",
        parameters: [{ name: "nullifierHash", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Withdrawal status" }, "404": { description: "No request observed for this nullifierHash" } },
      },
    },
    "/api/btc-withdrawal/solvency": {
      get: {
        tags: ["BTC Withdrawal"],
        summary: "Publicly checkable: custodian's real BTC balance vs. currently outstanding withdrawal obligations",
        responses: { "200": { description: "Solvency report" } },
      },
    },
  },
};
