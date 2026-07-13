'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Alert = { kind: 'error' | 'info'; text: string } | null;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [alert, setAlert] = useState<Alert>(searchParams.get('loggedOut') ? { kind: 'info', text: 'Logged out successfully.' } : null);

  useEffect(() => {
    if (!alert) return;

    const timeoutMs = alert.kind === 'error' ? 6500 : 3500;
    const timer = window.setTimeout(() => setAlert(null), timeoutMs);

    return () => window.clearTimeout(timer);
  }, [alert]);

  const nextPath = useMemo(() => {
    const raw = searchParams.get('next') || '/';
    if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
    return raw;
  }, [searchParams]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setAlert(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Login failed');

      router.replace(nextPath);
      router.refresh();
    } catch (err: unknown) {
      setAlert({ kind: 'error', text: err instanceof Error ? err.message : 'Login failed' });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="loginShell">
      <div className="loginCard">
        <div className="loginBadge">Admin access</div>
        <h1 style={{ marginBottom: 8 }}>Sign in first</h1>
        <p className="help" style={{ fontSize: 14 }}>
          Enter an email that is listed in <code>ADMIN_EMAILS</code>. The app will not load other pages until this login succeeds.
        </p>

        {alert ? (
          <div
            className={`alert ${alert.kind}`}
            style={{ marginTop: 16 }}
            role="status"
            aria-live="polite"
          >
            <span>{alert.text}</span>
            <button
              className="alertClose"
              type="button"
              aria-label="Close message"
              onClick={() => setAlert(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        <form onSubmit={onSubmit} style={{ marginTop: 18 }}>
          <label style={{ width: '100%' }}>
            Admin email
            <div style={{ marginTop: 6 }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                placeholder="admin@example.com"
                autoComplete="email"
                autoFocus
                required
                style={{ width: '100%', minWidth: 0 }}
              />
            </div>
          </label>

          <button type="submit" disabled={isLoading} style={{ width: '100%', marginTop: 16 }}>
            {isLoading ? 'Checking…' : 'Login'}
          </button>
        </form>

        <p className="help" style={{ marginTop: 14 }}>
          Set <code>ADMIN_EMAILS="your-email@gmail.com"</code> in <code>.env.local</code>, then restart <code>npm run dev</code>.
        </p>
      </div>
    </main>
  );
}


export default function LoginPage() {
  return (
    <Suspense fallback={<main className="loginShell"><div className="loginCard">Loading login…</div></main>}>
      <LoginForm />
    </Suspense>
  );
}
