import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CustomerIdentityClaim } from '../src/types.ts';

const MAX_SIGNATURE_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

export function signCustomerIdentity(secret: string, customerId: string, ts: number): string {
  return createHmac('sha256', secret).update(`${customerId}.${ts}`).digest('hex');
}

export function verifyCustomerIdentity(
  secret: string,
  claim: CustomerIdentityClaim | null | undefined
): { valid: boolean; customerId: string | null; error?: string } {
  if (!secret) return { valid: false, customerId: null, error: 'Customer identity is not configured for this bot.' };
  if (!claim || !claim.customerId || !claim.sig || !Number.isFinite(claim.ts)) {
    return { valid: false, customerId: null, error: 'Missing customer identity claim.' };
  }
  if (claim.customerId.length > 128) {
    return { valid: false, customerId: null, error: 'Customer ID too long.' };
  }
  const age = Date.now() - claim.ts;
  if (age > MAX_SIGNATURE_AGE_MS || age < -MAX_FUTURE_SKEW_MS) {
    return { valid: false, customerId: null, error: 'Customer identity signature expired. Sign in again.' };
  }
  const expected = Buffer.from(signCustomerIdentity(secret, claim.customerId, claim.ts), 'utf8');
  const provided = Buffer.from(String(claim.sig), 'utf8');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { valid: false, customerId: null, error: 'Invalid customer identity signature.' };
  }
  return { valid: true, customerId: claim.customerId };
}