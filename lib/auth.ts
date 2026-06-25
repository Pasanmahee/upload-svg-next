import { getFirebaseAuth } from '@/lib/firebaseAdmin';

export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const m = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export type AuthResult =
  | { ok: true; uid: string; email: string | null; name: string | null; provider: 'firebase' | 'admin-email' }
  | { ok: false; error: 'missing_token' | 'invalid_token' };

export type AdminAuthResult =
  | { ok: true; uid: string; email: string; name: string | null; provider: 'firebase' | 'admin-email' }
  | { ok: false; status: 401 | 403; error: 'Unauthorized' | 'Forbidden' | 'Admin email is not configured' };

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const cleaned = email.trim().toLowerCase();
  return cleaned.includes('@') ? cleaned : null;
}

export function getAdminEmails(): string[] {
  const raw = [
    process.env.ADMIN_EMAILS,
    process.env.ADMIN_EMAIL,
    process.env.FIREBASE_ADMIN_EMAILS,
  ]
    .filter(Boolean)
    .join(',');

  return Array.from(
    new Set(
      raw
        .split(/[;,\n]/g)
        .map((email) => normalizeEmail(email))
        .filter((email): email is string => Boolean(email))
    )
  );
}

export function isAdminEmail(email: unknown): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return getAdminEmails().includes(normalized);
}

function safeUidFromEmail(email: string): string {
  return `admin-email:${email}`;
}

function verifyAdminEmailFallback(request: Request): AuthResult | null {
  const email = normalizeEmail(request.headers.get('x-admin-email'));
  if (!email) return null;
  if (!isAdminEmail(email)) return { ok: false, error: 'invalid_token' };
  return { ok: true, uid: safeUidFromEmail(email), email, name: null, provider: 'admin-email' };
}

/**
 * Verifies Firebase ID token from Authorization: Bearer <token>.
 * Temporary fallback: if there is no Firebase token, x-admin-email is accepted
 * only when the email exactly matches ADMIN_EMAILS.
 */
export async function verifyFirebaseAuth(request: Request): Promise<AuthResult> {
  const token = extractBearerToken(request.headers.get('authorization'));

  if (!token) {
    const fallback = verifyAdminEmailFallback(request);
    return fallback || { ok: false, error: 'missing_token' };
  }

  try {
    const auth = getFirebaseAuth();
    // Optional revocation check (adds an extra lookup).
    // Enable by setting FIREBASE_CHECK_REVOKED=1 in the server environment.
    const checkRevoked = process.env.FIREBASE_CHECK_REVOKED === '1';
    const decoded = await auth.verifyIdToken(token, checkRevoked);
    if (!decoded?.uid) return { ok: false, error: 'invalid_token' };
    return {
      ok: true,
      uid: decoded.uid,
      email: normalizeEmail(decoded.email) || null,
      name: typeof decoded.name === 'string' ? decoded.name : null,
      provider: 'firebase',
    };
  } catch {
    const fallback = verifyAdminEmailFallback(request);
    return fallback || { ok: false, error: 'invalid_token' };
  }
}

export async function verifyAdminAuth(request: Request): Promise<AdminAuthResult> {
  const auth = await verifyFirebaseAuth(request);
  if (!auth.ok) return { ok: false, status: 401, error: 'Unauthorized' };

  const adminEmails = getAdminEmails();
  if (adminEmails.length === 0) {
    return { ok: false, status: 403, error: 'Admin email is not configured' };
  }

  if (!auth.email || !isAdminEmail(auth.email)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, uid: auth.uid, email: auth.email, name: auth.name, provider: auth.provider };
}

export async function getUidIfPresent(request: Request): Promise<string | null> {
  const fallback = verifyAdminEmailFallback(request);
  if (fallback?.ok) return fallback.uid;

  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token) return null;
  try {
    const auth = getFirebaseAuth();
    const decoded = await auth.verifyIdToken(token);
    return decoded?.uid || null;
  } catch {
    return null;
  }
}
