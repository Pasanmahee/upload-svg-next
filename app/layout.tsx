import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Upload & Process Image',
  description: 'Next.js API route for image → SVG and SVG → PNG processing',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
