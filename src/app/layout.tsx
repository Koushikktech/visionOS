import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'visionOS — Studio',
  description: 'Sketch, write, and build together on one local spatial canvas.',
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{var appearance=localStorage.getItem('visionos_appearance');if(appearance==='dark'||appearance==='light'||appearance==='system')document.documentElement.dataset.appearance=appearance}catch{}" }} />
      </head>
      <body className="antialiased overflow-hidden">
        {children}
      </body>
    </html>
  );
}
