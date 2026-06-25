'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const found = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}

export default function AuthBar() {
  const pathname = usePathname();
  const [email, setEmail] = useState('');

  useEffect(() => {
    setEmail(readCookie('uploadSvgAdminEmail'));
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login?loggedOut=1';
  }

  if (pathname === '/login') return null;

  return (
    <div className="authBar">
      <span>{email ? `Logged in: ${email}` : 'Logged in'}</span>
      <button type="button" className="secondary" onClick={logout}>
        Logout
      </button>
    </div>
  );
}
