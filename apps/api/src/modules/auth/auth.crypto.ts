// Auth crypto primitives — pure, no I/O, unit-testable.
//
// Token model (matches the Prisma schema's comments):
//   • magic-link tokens — 32 random bytes, base64url (~43 chars). The DB
//     stores ONLY sha256(token) hex, so a DB leak can't forge a link.
//   • session ids        — hex(randomBytes(32)) (64 chars). Stored as-is in
//     Session.id; the cookie value IS the row's primary key, so the cookie
//     itself is the secret. No second hash layer.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url, no padding. ~43 chars, 256 bits of entropy.
 *  Used for the RAW magic-link token (the part that goes in the email). */
export function generateMagicToken(): string {
  return randomBytes(32).toString('base64url');
}

/** hex(randomBytes(32)) → 64 hex chars. Used as Session.id (== cookie value).
 *  Schema comment on Session.id is literally "hex(randomBytes(32))". */
export function generateSessionId(): string {
  return randomBytes(32).toString('hex');
}

/** sha256(token) → 64-char hex. At-rest storage form for magic-link tokens. */
export function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare of two equal-length hex digests. */
export function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** Normalize an email for storage + comparison. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Cheap RFC-ish validity check. Good enough for UX gating, not RFC-5322. */
export function isLikelyEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}
