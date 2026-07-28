import { getBalances } from "../vault/vault.service";

export async function getPortfolio(address: string) {
  const vault = await getBalances(address);

  const publicValue = vault.publicBalances.reduce((sum, b) => sum + b.valueUsd, 0);
  const shieldedValue = vault.shieldedBalances.reduce((sum, b) => sum + b.valueUsd, 0);
  const netWorth = publicValue + shieldedValue;

  const history = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => ({
    day,
    value: Math.round(netWorth * (0.9 + i * 0.015)),
  }));

  return {
    address,
    publicValue,
    shieldedValue,
    netWorth,
    anonymityScore: vault.anonymityScore,
    allocation: [...vault.publicBalances, ...vault.shieldedBalances],
    history,
  };
}
