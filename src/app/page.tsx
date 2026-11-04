'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { CanvasLaunchFallback } from '@/components/LaunchRecoveryScreen';
import VisionDashboard from '@/components/VisionDashboard';
import type { WorkspaceLaunchIntent } from '@/lib/workspaceStudio';
import { readLocalStorage } from '@/lib/browserStorage';

const Canvas = dynamic(() => import('@/components/Canvas'), {
  ssr: false,
  loading: (props) => <CanvasLaunchFallback {...props} />,
});

export default function Home() {
  // Resolve the URL before rendering either destination. Direct canvas links never flash Studio.
  const [view, setView] = useState<'dashboard' | 'canvas' | null>(null);
  const [canvasMounted, setCanvasMounted] = useState(false);
  const [intent, setIntent] = useState<WorkspaceLaunchIntent>();
  const consumed = useRef(new Set<string>());
  const studioScroll = useRef(0);

  useEffect(() => {
    const appearance = readLocalStorage('visionos_appearance').value;
    if (appearance === 'light' || appearance === 'dark' || appearance === 'system') {
      document.documentElement.dataset.appearance = appearance;
    }
    const syncView = () => {
      const params = new URLSearchParams(window.location.search);
      setIntent(params.get('view') === 'canvas'
        ? { id: crypto.randomUUID(), kind: 'open', pageId: params.get('page') ?? undefined }
        : undefined);
      if (params.get('view') === 'canvas') setCanvasMounted(true);
      setView(params.get('view') === 'canvas' ? 'canvas' : 'dashboard');
    };
    syncView();
    window.addEventListener('popstate', syncView);
    return () => window.removeEventListener('popstate', syncView);
  }, []);

  const handleOpenCanvas = useCallback((options?: {
    prompt?: string; template?: string; intent?: WorkspaceLaunchIntent;
  }) => {
    studioScroll.current = document.querySelector('[data-studio-scroll]')?.scrollTop ?? 0;
    const nextIntent = options?.intent ?? {
      id: crypto.randomUUID(),
      kind: options?.prompt ? 'draft' : options?.template ? 'example' : 'open',
      draft: options?.prompt,
      example: options?.template ? 'field-notes' : undefined,
    } as WorkspaceLaunchIntent;
    if (consumed.current.has(nextIntent.id)) return;
    setIntent(nextIntent);
    setCanvasMounted(true);
    setView('canvas');
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'canvas');
    if (nextIntent.pageId) url.searchParams.set('page', nextIntent.pageId);
    else url.searchParams.delete('page');
    window.history.pushState({ view: 'canvas' }, '', url);
  }, []);

  const handleGoToDashboard = useCallback(() => {
    setIntent(undefined);
    setView('dashboard');
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'dashboard');
    url.searchParams.delete('page');
    window.history.pushState({ view: 'dashboard' }, '', url);
  }, []);

  useEffect(() => {
    if (view !== 'dashboard') return;
    const frame = requestAnimationFrame(() => {
      const scroller = document.querySelector('[data-studio-scroll]');
      if (scroller) scroller.scrollTop = studioScroll.current;
      if (consumed.current.size) document.querySelector<HTMLElement>('[data-studio-continue]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [view]);

  if (view === null) return <CanvasLaunchFallback isLoading />;
  return <>
    {view === 'dashboard' && <VisionDashboard onOpenCanvas={handleOpenCanvas} onOpenTour={() => handleOpenCanvas({
      intent: { id: crypto.randomUUID(), kind: 'example', example: 'field-notes' },
    })} />}
    {canvasMounted && <div style={{ display: view === 'canvas' ? 'contents' : 'none' }}><Canvas active={view === 'canvas'} onGoToDashboard={handleGoToDashboard} launchIntent={intent}
      onIntentConsumed={(id) => {
        consumed.current.add(id);
        setIntent((current) => current?.id === id ? undefined : current);
      }} /></div>}
  </>;
}
