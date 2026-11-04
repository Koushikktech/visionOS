'use client';

import { useEffect, useState } from 'react';
import { getCanvasLaunchStatus } from '@/lib/launchRecovery';

type RecoveryMode = 'loading' | 'slow' | 'failed' | 'runtime' | 'fatal';

type LaunchRecoveryScreenProps = {
  mode: RecoveryMode;
  onRetry?: () => void;
  onGoToDashboard?: () => void;
};

const COPY: Record<RecoveryMode, { title: string; description: string }> = {
  loading: {
    title: 'Opening your canvas',
    description: 'Loading the workspace on this device…',
  },
  slow: {
    title: 'Taking longer than expected',
    description: 'The spatial engine is taking extra time to start. You can continue waiting, return to Studio, or reload.',
  },
  failed: {
    title: 'The canvas could not load',
    description: 'Reload the app to try loading the spatial engine again.',
  },
  runtime: {
    title: 'The canvas ran into a problem',
    description: 'Try opening it again. Reloading keeps saved canvas data and settings; unsaved edits could be lost.',
  },
  fatal: {
    title: 'visionOS could not start',
    description: 'Try opening the app again. Reloading preserves saved local canvas data and model settings.',
  },
};

export default function LaunchRecoveryScreen({ mode, onRetry, onGoToDashboard }: LaunchRecoveryScreenProps) {
  const [isReloading, setIsReloading] = useState(false);
  const copy = COPY[mode];
  const isLoading = mode === 'loading';
  const goToStudio = () => {
    if (onGoToDashboard) onGoToDashboard();
    else window.location.href = '/?view=dashboard';
  };
  return (
    <main className="studio-launch-screen" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--studio-workspace, #121416)', color: 'var(--studio-text, #f2f3f5)' }}>
      <section aria-labelledby="launch-recovery-title" role={isLoading ? 'status' : 'alert'} style={{ maxWidth: 480, padding: 32, borderRadius: 20, background: 'var(--studio-surface, #1b1e22)' }}>
        <p style={{ margin: '0 0 24px', fontSize: 16 }}>visionOS <span style={{ color: 'var(--studio-secondary, #a6adb5)' }}>/ Studio</span></p>
        <h1 id="launch-recovery-title" style={{ fontSize: 24, lineHeight: 1.3, fontWeight: 600, marginBottom: 12 }}>{copy.title}</h1>
        <p style={{ color: 'var(--studio-secondary, #a6adb5)', fontSize: 16, lineHeight: 1.5 }}>{copy.description}</p>
        {!isLoading && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
          {onRetry && <button type="button" className="studio-action" onClick={onRetry}>Try again</button>}
          <button type="button" className="studio-action" onClick={goToStudio}>Back to Studio</button>
          <button type="button" className="studio-action studio-action-primary" disabled={isReloading} onClick={() => { setIsReloading(true); window.location.reload(); }}>{isReloading ? 'Reloading…' : 'Reload app'}</button>
        </div>}
      </section>
    </main>
  );
}

export function CanvasLaunchFallback({
  error,
  isLoading,
  timedOut,
  onGoToDashboard,
}: {
  error?: unknown;
  isLoading?: boolean;
  timedOut?: boolean;
  onGoToDashboard?: () => void;
}) {
  const [localTimeout, setLocalTimeout] = useState(false);

  useEffect(() => {
    setLocalTimeout(false);
    if (!isLoading || timedOut) return;

    const timeout = window.setTimeout(() => setLocalTimeout(true), 20_000);
    return () => window.clearTimeout(timeout);
  }, [isLoading, timedOut]);

  const status = getCanvasLaunchStatus({
    error,
    isLoading,
    timedOut: timedOut || localTimeout,
  });

  return <LaunchRecoveryScreen mode={status} onGoToDashboard={onGoToDashboard} />;
}
