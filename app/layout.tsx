import './globals.css';
import type { ReactNode } from 'react';
import AuthBar from '@/components/AuthBar';

export const metadata = {
  title: 'Upload & Process Image',
  description: 'Browser-side image → paint-by-number SVG processing with Next.js draft storage',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AuthBar />
        {children}
      </body>
    </html>
  );
}
