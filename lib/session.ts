export const AUTH_COOKIE_NAME = 'uploadSvgAdminSession';
export const AUTH_EMAIL_COOKIE_NAME = 'uploadSvgAdminEmail';

const encoder = new TextEncoder();

export function normalizeSessionEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const cleaned = email.trim().toLowerCase();
  return cleaned.includes('@') ? cleaned : null;
}

export function getSessionSecret(): string {
  const secret =
    process.env.ADMIN_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ADMIN_EMAILS ||
    'dev-only-change-this-admin-session-secret';
  return String(secret);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function stringToBase64Url(value: string): string {
  const bytes = encoder.encode(value);
  return bytesToBase64Url(bytes);
}

function base64UrlToString(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    if (typeof atob === 'function') {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

async function hmacSha256(message: string, secret = getSessionSecret()): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function createSessionToken(email: string): Promise<string> {
  const normalized = normalizeSessionEmail(email);
  if (!normalized) throw new Error('Invalid email');
  const payload = stringToBase64Url(JSON.stringify({ email: normalized, v: 1 }));
  const signature = await hmacSha256(payload);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<{ email: string } | null> {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.', 2);
  if (!payload || !signature) return null;

  const expected = await hmacSha256(payload);
  if (!safeCompare(signature, expected)) return null;

  const json = base64UrlToString(payload);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as { email?: unknown };
    const email = normalizeSessionEmail(parsed.email);
    return email ? { email } : null;
  } catch {
    return null;
  }
}

export function getCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function getSessionEmailFromCookieHeader(cookieHeader: string | null | undefined): Promise<string | null> {
  const token = getCookieValue(cookieHeader, AUTH_COOKIE_NAME);
  const session = await verifySessionToken(token);
  return session?.email || null;
}
