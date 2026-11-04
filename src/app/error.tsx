'use client';

import LaunchRecoveryScreen from '@/components/LaunchRecoveryScreen';

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <LaunchRecoveryScreen mode="runtime" onRetry={reset} />;
}
