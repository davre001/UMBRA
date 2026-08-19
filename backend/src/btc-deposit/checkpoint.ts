import { logger } from "../shared/logger";

/**
 * The signet block height this backend currently assumes is registered
 * on-chain as `ShieldedVault.checkpoints[BTC_SIGNET_SOURCE_CHAIN_ID]`.
 *
 * Necessarily tracked here, separately from the chain itself: the on-chain
 * mapping stores a Poseidon2 COMMITMENT (see BTC_DEPOSIT_DESIGN.md's
 * "Public-input interface" section), not the raw height/hash — Poseidon2
 * is one-way, so there is no way to recover "which real block this is"
 * from the on-chain value alone. Two things write here now: the one-time
 * genesis bootstrap (`contract/scripts/initialize-btc-checkpoint.ts`) and,
 * for every advance after that, `btc-checkpoint-relay-worker/`'s own poll
 * loop — its `extendCheckpoint` calls are permissionless (see
 * `ShieldedVault.sol`'s own NatSpec), so this tracker can no longer assume
 * only an admin script ever moves the checkpoint. Either way, whoever just
 * advanced it on-chain is the only source of truth for what height that
 * corresponds to, so it must tell this backend directly (via
 * `setCurrentCheckpointHeight`, called through the secret-gated
 * POST /checkpoint route) rather than this backend inferring it. The
 * companion GET /checkpoint route (public, no secret) is how
 * `btc-checkpoint-relay-worker` itself reads this back each poll to figure
 * out where to resume from.
 *
 * In-memory only, seeded from BTC_CHECKPOINT_HEIGHT if set — a restart
 * loses track until the next refresh runs or the env var is set again.
 * Same disclosed simplification as store.ts's in-memory records.
 */
let currentCheckpointHeight: number | undefined = process.env.BTC_CHECKPOINT_HEIGHT
  ? Number(process.env.BTC_CHECKPOINT_HEIGHT)
  : undefined;

export function getCurrentCheckpointHeight(): number | undefined {
  return currentCheckpointHeight;
}

export function setCurrentCheckpointHeight(height: number): void {
  currentCheckpointHeight = height;
  logger.info(`[btc-deposit] checkpoint height updated to ${height}`);
}
