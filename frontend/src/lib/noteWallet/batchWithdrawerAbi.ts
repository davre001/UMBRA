export const BATCH_WITHDRAWER_ABI = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "vault", "type": "address" },
      { "indexed": true, "internalType": "uint256", "name": "index", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "nullifierHash", "type": "uint256" },
      { "indexed": false, "internalType": "bool", "name": "success", "type": "bool" }
    ],
    "name": "WithdrawAttempted",
    "type": "event"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "vault", "type": "address" },
      {
        "components": [
          { "internalType": "bytes", "name": "proof", "type": "bytes" },
          { "internalType": "uint256", "name": "root", "type": "uint256" },
          { "internalType": "uint256", "name": "nullifierHash", "type": "uint256" },
          { "internalType": "uint256", "name": "amount", "type": "uint256" },
          { "internalType": "uint256", "name": "assetId", "type": "uint256" },
          { "internalType": "address", "name": "recipient", "type": "address" }
        ],
        "internalType": "struct BatchWithdrawer.WithdrawCall[]",
        "name": "calls",
        "type": "tuple[]"
      }
    ],
    "name": "batchWithdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
