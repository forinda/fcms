/**
 * Session tokens.
 *
 * The token goes to the browser; only its hash is stored. A database read, a
 * backup or a leaked dump must not hand out live sessions.
 */
import { createHash, randomBytes } from "node:crypto";

/** 256 bits, base64url so it survives a cookie without escaping. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
