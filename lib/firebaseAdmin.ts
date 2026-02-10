import admin from 'firebase-admin';

declare global {
  // eslint-disable-next-line no-var
  var __firebaseAdminApp: admin.app.App | undefined;
}

function readServiceAccountFromEnv(): admin.ServiceAccount | null {
  const jsonStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_ADMIN_SA_JSON;
  if (jsonStr) {
    try {
      return JSON.parse(jsonStr) as admin.ServiceAccount;
    } catch {
      // ignore
    }
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64 || process.env.FIREBASE_ADMIN_SA_B64;
  if (b64) {
    try {
      const raw = Buffer.from(b64, 'base64').toString('utf8');
      return JSON.parse(raw) as admin.ServiceAccount;
    } catch {
      // ignore
    }
  }

  return null;
}

export function getFirebaseAdminApp(): admin.app.App {
  if (global.__firebaseAdminApp) return global.__firebaseAdminApp;

  const serviceAccount = readServiceAccountFromEnv();
  const projectId = process.env.FIREBASE_PROJECT_ID || (serviceAccount as any)?.project_id;

  if (!admin.apps.length) {
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId,
      });
    }
  }

  global.__firebaseAdminApp = admin.app();
  return global.__firebaseAdminApp;
}

export function getFirebaseAuth(): admin.auth.Auth {
  getFirebaseAdminApp();
  return admin.auth();
}
