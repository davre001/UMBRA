import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory, { type ECPairInterface } from "ecpair";
import * as ecc from "tiny-secp256k1";
import { logger } from "../shared/logger";

/**
 * The custodian wallet's real private key — signs real signet Bitcoin
 * transactions. This is the actual centralization point of the whole BTC
 * withdrawal path, disclosed plainly rather than buried: nothing
 * cryptographic stops this key's holder from simply not paying out a
 * fulfilled-on-EVM withdrawal request. See circuits/BTC_DEPOSIT_DESIGN.md's
 * "Withdrawal" section for the full trust-model writeup and the solvency
 * counter that makes dishonesty visible (not impossible).
 *
 * Signet uses the same address-encoding parameters as Bitcoin's testnet
 * (bech32 hrp "tb", same version bytes) — they differ in genesis
 * block/consensus rules, not address format — so bitcoinjs-lib's built-in
 * `networks.testnet` is the correct network object for signet addresses.
 * Confirmed against a real signet address from mempool.space (`tb1q...`)
 * before relying on this, not assumed from the two names sounding similar.
 */
export const SIGNET_NETWORK = bitcoin.networks.testnet;

const ECPair = ECPairFactory(ecc);

let cachedKeyPair: ECPairInterface | null = null;

/** Loads the custodian's keypair from BTC_CUSTODIAN_WIF (Wallet Import Format) — never logged, never returned as a string anywhere in this module. */
function getKeyPair(): ECPairInterface {
  if (cachedKeyPair) return cachedKeyPair;
  const wif = process.env.BTC_CUSTODIAN_WIF;
  if (!wif) throw new Error("BTC_CUSTODIAN_WIF not set — see .env.example. No BTC withdrawal can be fulfilled without it.");
  cachedKeyPair = ECPair.fromWIF(wif, SIGNET_NETWORK);
  return cachedKeyPair;
}

let cachedAddress: string | null = null;

/** The custodian's own P2WPKH signet address — the same fixed address `contract/circuits/noir/btc_deposit/src/bitcoin.nr`'s `VAULT_PUBKEY_HASH` must be configured to (deposits pay into it; withdrawals pay out of it). */
export function getCustodianAddress(): string {
  if (cachedAddress) return cachedAddress;
  const keyPair = getKeyPair();
  const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: SIGNET_NETWORK });
  if (!address) throw new Error("Failed to derive a P2WPKH address from BTC_CUSTODIAN_WIF");
  cachedAddress = address;
  logger.info(`[btc-withdrawal] custodian address: ${address}`);
  return address;
}

/** The custodian's own P2WPKH pubkey hash (hash160, 20 bytes hex) — must match `bitcoin::VAULT_PUBKEY_HASH` in the deposit circuit and `BTC_VAULT_PUBKEY_HASH` in backend/src/btc-deposit/mempool.ts exactly, or deposits and withdrawals disagree about which address is the vault. */
export function getCustodianPubkeyHash(): string {
  const keyPair = getKeyPair();
  const { output } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: SIGNET_NETWORK });
  if (!output) throw new Error("Failed to derive a P2WPKH script from BTC_CUSTODIAN_WIF");
  // output = OP_0 <20-byte hash> (0x00 0x14 <20 bytes>) — strip the 2-byte push prefix.
  return Buffer.from(output).subarray(2).toString("hex");
}

export function getKeyPairForSigning(): ECPairInterface {
  return getKeyPair();
}
