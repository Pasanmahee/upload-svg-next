'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Process Image' },
  { href: '/upload-svg', label: 'Upload SVG' },
  { href: '/manage-images', label: 'Manage Images' },
  { href: '/game-settings', label: 'Game Settings' },
  { href: '/pack-management', label: 'Pack Management' },
];

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
    <header className="authBar">
      <Link className="brandLink" href="/" aria-label="Go to Process Image page">
        SVG Paint Admin
      </Link>

      <nav className="navLinks" aria-label="Main navigation">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={`navLink${active ? ' active' : ''}`}>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="authActions">
        <span className="loggedInText">{email ? email : 'Logged in'}</span>
        <button type="button" className="secondary" onClick={logout}>
          Logout
        </button>
      </div>
    </header>
  );
}
