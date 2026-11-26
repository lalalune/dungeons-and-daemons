/**
 * Optional access code for private deployments.
 *
 * When ACCESS_CODE is set, nothing but the lock screen works until a visitor
 * enters the code; they then carry a signed cookie. With no ACCESS_CODE the
 * server is open, as in local development.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const COOKIE = 'dnd_access';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function code(): string | null {
  const value = process.env.ACCESS_CODE?.trim();
  return value ? value : null;
}

export function accessRequired(): boolean {
  return code() !== null;
}

/** The cookie value proves knowledge of the code without containing it. */
function passValue(secret: string): string {
  return createHmac('sha256', secret).update('dungeons-and-daemons-access-v1').digest('hex');
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function codeMatches(attempt: unknown): boolean {
  const secret = code();
  if (!secret || typeof attempt !== 'string') return false;
  // Compare digests so length differences leak nothing.
  return same(passValue(attempt.trim()), passValue(secret));
}

/** True when the request's Cookie header carries a valid pass (or no code is set). */
export function hasAccess(cookieHeader: string | undefined): boolean {
  const secret = code();
  if (!secret) return true;
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE && same(rest.join('='), passValue(secret))) return true;
  }
  return false;
}

export function accessCookie(secure: boolean): string {
  const secret = code();
  if (!secret) return '';
  return `${COOKIE}=${passValue(secret)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
