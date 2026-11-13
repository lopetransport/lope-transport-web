import { createHash, randomBytes } from 'node:crypto';

export const validTrackingToken = /^[A-Za-z0-9_-]{43}$/;

export function hashTrackingToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** Persist the hash and expiry before returning the URL to dispatch. */
export function createTrackingGrant(siteOrigin: string, waybillId: string) {
  const token = randomBytes(32).toString('base64url');
  const url = new URL('/track/' + encodeURIComponent(waybillId), siteOrigin);
  url.hash = token;
  return { url: url.toString(), tokenHash: hashTrackingToken(token) };
}

