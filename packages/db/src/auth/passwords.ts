/**
 * Password hashing.
 *
 * argon2id with OWASP's baseline. Tuned down it stops being worth the
 * dependency; tuned up a login pins a core on the small box doc 14 targets.
 *
 * `verify` never says *why* a check failed — an unknown hash format and a wrong
 * password both return false, so nothing here becomes an oracle.
 */
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argonVerify(hash, password);
  } catch {
    // A malformed hash is a failed check, not a 500.
    return false;
  }
}
