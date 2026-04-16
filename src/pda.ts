import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";

/** Matches `get_seed` in `programs/pre-sale-pool/src/utils.rs` (SHA-256 of UTF-8 string). */
export function getSeed(...parts: string[]): Uint8Array {
  return sha256(new TextEncoder().encode(parts.join("")));
}

export function pda(programId: PublicKey, seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export const BLANK = new PublicKey("11111111111111111111111111111111");

export function poolsCountPda(programId: PublicKey): PublicKey {
  return pda(programId, [getSeed("POOLS::COUNT")]);
}

export function poolMetadataPda(programId: PublicKey, index: number): PublicKey {
  return pda(programId, [getSeed(`POOL::METADATA::${index}`)]);
}

export function offeredCurrencyPda(
  programId: PublicKey,
  poolIndex: number,
  currency: PublicKey
): PublicKey {
  return pda(programId, [
    getSeed(
      "POOL::DATA::",
      String(poolIndex),
      "::OFFERED_CURRENCY::",
      currency.toBase58()
    ),
  ]);
}

export function userPurchasedPda(
  programId: PublicKey,
  poolIndex: number,
  user: PublicKey
): PublicKey {
  return pda(programId, [
    getSeed(
      "POOL::DATA::",
      String(poolIndex),
      "::USER_PURCHASED::",
      user.toBase58()
    ),
  ]);
}

export function userByCurrencyPda(
  programId: PublicKey,
  poolIndex: number,
  user: PublicKey,
  currency: PublicKey
): PublicKey {
  return pda(programId, [
    getSeed(
      "POOL::DATA::",
      String(poolIndex),
      "::USER_BY_CURRENCY::",
      user.toBase58(),
      "::",
      currency.toBase58()
    ),
  ]);
}

export function userClaimedPda(
  programId: PublicKey,
  poolIndex: number,
  candidate: PublicKey
): PublicKey {
  return pda(programId, [
    getSeed(
      "POOL::DATA::",
      String(poolIndex),
      "::USER_CLAIMED::",
      candidate.toBase58()
    ),
  ]);
}

export function refundCurrencyPda(
  programId: PublicKey,
  poolIndex: number,
  currency: PublicKey
): PublicKey {
  return pda(programId, [
    getSeed(
      "POOL::DATA::",
      String(poolIndex),
      "::REFUND_CURRENCY::",
      currency.toBase58()
    ),
  ]);
}

export function rustU16(n: number): string {
  return String(n & 0xffff);
}
