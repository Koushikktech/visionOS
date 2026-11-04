'use client';

import LaunchRecoveryScreen from '@/components/LaunchRecoveryScreen';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className="m-0 min-h-dvh bg-[#08090d] text-white antialiased"
        style={{ margin: 0, minHeight: '100dvh', backgroundColor: '#08090d', color: '#f4f4f5' }}
      >
        <LaunchRecoveryScreen mode="fatal" onRetry={reset} />
      </body>
    </html>
  );
}
