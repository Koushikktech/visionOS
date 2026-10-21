import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CanvasOS - Spatial Operating System',
  description: 'AI-native spatial operating system for thinking',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased overflow-hidden bg-[#0d0e12] select-none">
        {children}
      </body>
    </html>
  );
}
