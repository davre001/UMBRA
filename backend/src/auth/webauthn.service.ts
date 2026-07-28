function randomHex(bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

const pendingChallenges = new Set<string>();

export function createChallenge(): string {
  const challengeId = randomHex(16);
  pendingChallenges.add(challengeId);
  return challengeId;
}

export function verifyChallenge(challengeId: string): boolean {
  const isValid = pendingChallenges.has(challengeId);
  pendingChallenges.delete(challengeId);
  return isValid;
}
