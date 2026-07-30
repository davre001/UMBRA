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
    { name: "Vault" },
    { name: "Portfolio" },
    { name: "Pricing" },
    { name: "Swap" },
    { name: "Compliance" },
    { name: "Stealth" },
    { name: "Prover" },
    { name: "Relayer" },
    { name: "Auth" },
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
    "/api/vault/{address}/balances": {
      get: {
        tags: ["Vault"],
        summary: "Get shielded balances for an address",
        parameters: [
          { name: "address", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Balances for the vault" } },
      },
    },
    "/api/vault/shield": {
      post: {
        tags: ["Vault"],
        summary: "Shield an asset into the vault",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address", "asset", "amount"],
                properties: {
                  address: { type: "string" },
                  asset: { type: "string" },
                  amount: { type: "number" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Shield result" } },
      },
    },
    "/api/vault/withdraw": {
      post: {
        tags: ["Vault"],
        summary: "Withdraw a shielded asset",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address", "asset", "amount", "destination"],
                properties: {
                  address: { type: "string" },
                  asset: { type: "string" },
                  amount: { type: "number" },
                  destination: { type: "string" },
                  gasless: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Withdraw result" } },
      },
    },
    "/api/vault/pay": {
      post: {
        tags: ["Vault"],
        summary: "Pay from the vault to a destination",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address", "asset", "amount", "destination"],
                properties: {
                  address: { type: "string" },
                  asset: { type: "string" },
                  amount: { type: "number" },
                  destination: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Payment result" } },
      },
    },
    "/api/portfolio/{address}": {
      get: {
        tags: ["Portfolio"],
        summary: "Get aggregated portfolio holdings",
        parameters: [
          { name: "address", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Portfolio holdings" } },
      },
    },
    "/api/pricing/{fromAsset}/{toAsset}": {
      get: {
        tags: ["Pricing"],
        summary: "Get FTSO midpoint exchange rate",
        parameters: [
          { name: "fromAsset", in: "path", required: true, schema: { type: "string" } },
          { name: "toAsset", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Rate for the asset pair" } },
      },
    },
    "/api/swap/intent": {
      post: {
        tags: ["Swap"],
        summary: "Submit a dark-engine swap intent",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address", "fromAsset", "toAsset", "fromAmount", "toAmount"],
                properties: {
                  address: { type: "string" },
                  fromAsset: { type: "string" },
                  toAsset: { type: "string" },
                  fromAmount: { type: "number" },
                  toAmount: { type: "number" },
                  slippage: { type: "number" },
                  mevProtection: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Created intent" } },
      },
    },
    "/api/swap/{id}": {
      get: {
        tags: ["Swap"],
        summary: "Get a swap intent by id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Intent found" },
          "404": { description: "Intent not found" },
        },
      },
    },
    "/api/compliance/screen": {
      post: {
        tags: ["Compliance"],
        summary: "Screen an address via FDC",
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
        responses: { "200": { description: "Screening result" } },
      },
    },
    "/api/compliance/viewing-key/{address}": {
      get: {
        tags: ["Compliance"],
        summary: "Get a compliance viewing key for an address",
        parameters: [
          { name: "address", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Viewing key" } },
      },
    },
    "/api/stealth/derive": {
      post: {
        tags: ["Stealth"],
        summary: "Derive a one-time stealth address",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { asset: { type: "string" }, amount: { type: "number" } },
              },
            },
          },
        },
        responses: { "200": { description: "Stealth address and payment link" } },
      },
    },
    "/api/stealth/resolve": {
      post: {
        tags: ["Stealth"],
        summary: "Resolve a recipient to a stealth address",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["recipientType", "recipient"],
                properties: {
                  recipientType: { type: "string" },
                  recipient: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Resolved stealth address" } },
      },
    },
    "/api/prover/prove": {
      post: {
        tags: ["Prover"],
        summary: "Generate a zero-knowledge proof",
        requestBody: {
          required: false,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": { description: "Generated proof" } },
      },
    },
    "/api/relayer/relay": {
      post: {
        tags: ["Relayer"],
        summary: "Relay a gasless transaction",
        requestBody: {
          required: false,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": { description: "Relay transaction hash" } },
      },
    },
    "/api/auth/passkey/challenge": {
      post: {
        tags: ["Auth"],
        summary: "Create a WebAuthn passkey challenge",
        responses: { "200": { description: "Challenge id" } },
      },
    },
    "/api/auth/passkey/verify": {
      post: {
        tags: ["Auth"],
        summary: "Verify a WebAuthn passkey challenge",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["challengeId"],
                properties: { challengeId: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Verification result" } },
      },
    },
  },
};
