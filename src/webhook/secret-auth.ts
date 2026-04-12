import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies the X-ISR-Secret header against the configured secret.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifySecret(headers: Record<string, string | string[] | undefined>, secret: string): boolean {
  const provided = headers['x-isr-secret'];
  if (!provided) return false;

  const value = Array.isArray(provided) ? provided[0] : provided;

  try {
    const a = Buffer.from(value, 'utf8');
    const b = Buffer.from(secret, 'utf8');

    if (a.length !== b.length) {
      // Still do a comparison to avoid timing leak on length
      timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
      return false;
    }

    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verifies an HMAC-SHA256 signature.
 * Used by CMS adapters (e.g. Sanity) that sign their webhooks.
 */
export function verifyHmacSha256(
  payload: string,
  secret: string,
  signature: string,
  algorithm = 'sha256',
): boolean {
  try {
    const expected = createHmac(algorithm, secret).update(payload).digest('hex');
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
