import { getFirebaseAuth } from '@/lib/firebaseAdmin';

export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const m = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export type AuthResult =
  | { ok: true; uid: string }
  | { ok: false; error: 'missing_token' | 'invalid_token' };

/**
 * Verifies Firebase ID token from Authorization: Bearer <token>.
 * Returns uid on success.
 */
export async function verifyFirebaseAuth(request: Request): Promise<AuthResult> {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token) return { ok: false, error: 'missing_token' };

  try {
    const auth = getFirebaseAuth();
    // Optional revocation check (adds an extra lookup).
    // Enable by setting FIREBASE_CHECK_REVOKED=1 in the server environment.
    const checkRevoked = process.env.FIREBASE_CHECK_REVOKED === '1';
    const decoded = await auth.verifyIdToken(token, checkRevoked);
    if (!decoded?.uid) return { ok: false, error: 'invalid_token' };
    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, error: 'invalid_token' };
  }
}

export async function getUidIfPresent(request: Request): Promise<string | null> {
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
