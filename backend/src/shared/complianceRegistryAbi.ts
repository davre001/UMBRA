export const COMPLIANCE_REGISTRY_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "account", "type": "address" },
      { "internalType": "bool", "name": "clear", "type": "bool" }
    ],
    "name": "screen",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "isScreened",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "screenResults",
    "outputs": [
      { "internalType": "bool", "name": "clear", "type": "bool" },
      { "internalType": "uint64", "name": "screenedAt", "type": "uint64" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
