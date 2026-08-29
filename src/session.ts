// Cookieベースのセッション。Cloudflare Access(Cf-Access-Jwt-Assertion)を廃止し、
// このWorker自身がログインを検証してセッションCookieを発行・検証する(src/api/auth.ts, src/db/sessions.ts)。

import { createSession, findSessionEmail, deleteSession } from './db/sessions';
import { generateSessionToken, hashSessionToken } from './crypto';

const COOKIE_NAME = 'admin_session';

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function buildCookie(value: string, expires: Date): string {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

export async function getSessionEmail(request: Request, db: D1Database): Promise<string | null> {
  const token = parseCookie(request.headers.get('Cookie'), COOKIE_NAME);
  if (!token) return null;
  return findSessionEmail(db, await hashSessionToken(token));
}

export async function issueSessionCookie(db: D1Database, email: string): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = await createSession(db, await hashSessionToken(token), email);
  return buildCookie(token, expiresAt);
}

export async function clearSessionCookie(request: Request, db: D1Database): Promise<string> {
  const token = parseCookie(request.headers.get('Cookie'), COOKIE_NAME);
  if (token) await deleteSession(db, await hashSessionToken(token));
  return buildCookie('', new Date(0));
}
