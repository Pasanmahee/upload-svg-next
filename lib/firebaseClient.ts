'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type Auth } from 'firebase/auth';

export function hasFirebasePublicConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  );
}

function requiredPublicEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env.local and restart npm run dev.`);
  }
  return value;
}

export function getFirebaseClientAuth(): Auth {
  const firebaseConfig = {
    apiKey: requiredPublicEnv('NEXT_PUBLIC_FIREBASE_API_KEY', process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: requiredPublicEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: requiredPublicEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    appId: requiredPublicEnv('NEXT_PUBLIC_FIREBASE_APP_ID', process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

export async function signInWithGooglePopup() {
  const auth = getFirebaseClientAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export async function signOutFirebase() {
  const auth = getFirebaseClientAuth();
  return signOut(auth);
}
