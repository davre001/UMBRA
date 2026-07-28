import { AssetBalance, VaultState } from "../shared/types";
import { SUPPORTED_ASSETS } from "../shared/constants";
import { generateProof } from "../prover/prover.service";
import { relay } from "../relayer/relayer.service";

const vaults = new Map<string, VaultState>();

function getOrCreateVault(address: string): VaultState {
  let vault = vaults.get(address);
  if (!vault) {
    vault = {
      address,
      publicBalances: SUPPORTED_ASSETS.map((asset) => ({
        asset,
        balance: 10000,
        valueUsd: 10000,
      })),
      shieldedBalances: SUPPORTED_ASSETS.map((asset) => ({
        asset,
        balance: 0,
        valueUsd: 0,
      })),
      anonymityScore: 85,
    };
    vaults.set(address, vault);
  }
  return vault;
}

function findBalance(balances: AssetBalance[], asset: string): AssetBalance {
  const found = balances.find((b) => b.asset === asset);
  if (!found) throw new Error(`Unsupported asset: ${asset}`);
  return found;
}

export async function getBalances(address: string): Promise<VaultState> {
  return getOrCreateVault(address);
}

export async function shield(address: string, asset: string, amount: number) {
  const vault = getOrCreateVault(address);
  const publicBalance = findBalance(vault.publicBalances, asset);
  const shieldedBalance = findBalance(vault.shieldedBalances, asset);
  if (publicBalance.balance < amount) {
    throw new Error("Insufficient public balance");
  }

  const proof = await generateProof({ address, asset, amount, action: "shield" });

  publicBalance.balance -= amount;
  publicBalance.valueUsd = publicBalance.balance;
  shieldedBalance.balance += amount;
  shieldedBalance.valueUsd = shieldedBalance.balance;
  vault.anonymityScore = Math.min(100, vault.anonymityScore + 1);

  return { vault, proof };
}

export async function withdraw(
  address: string,
  asset: string,
  amount: number,
  destination: string,
  gasless: boolean
) {
  const vault = getOrCreateVault(address);
  const shieldedBalance = findBalance(vault.shieldedBalances, asset);
  const publicBalance = findBalance(vault.publicBalances, asset);
  if (shieldedBalance.balance < amount) {
    throw new Error("Insufficient shielded balance");
  }

  const proof = await generateProof({ address, asset, amount, action: "withdraw" });

  let relayTxHash: string | undefined;
  if (gasless) {
    relayTxHash = await relay({ address, asset, amount, destination });
  }

  shieldedBalance.balance -= amount;
  shieldedBalance.valueUsd = shieldedBalance.balance;
  publicBalance.balance += amount;
  publicBalance.valueUsd = publicBalance.balance;

  return { vault, proof, relayTxHash };
}

export async function pay(
  address: string,
  asset: string,
  amount: number,
  destination: string
) {
  const vault = getOrCreateVault(address);
  const shieldedBalance = findBalance(vault.shieldedBalances, asset);
  if (shieldedBalance.balance < amount) {
    throw new Error("Insufficient shielded balance");
  }

  const proof = await generateProof({ address, asset, amount, action: "pay" });

  shieldedBalance.balance -= amount;
  shieldedBalance.valueUsd = shieldedBalance.balance;

  // If the destination happens to be a known vault (not an external
  // stealth address), credit it directly for a fully in-memory demo.
  const recipientVault = vaults.get(destination);
  if (recipientVault) {
    const recipientBalance = findBalance(recipientVault.shieldedBalances, asset);
    recipientBalance.balance += amount;
    recipientBalance.valueUsd = recipientBalance.balance;
  }

  return { vault, proof };
}
