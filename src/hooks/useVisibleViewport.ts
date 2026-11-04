'use client';

import { useEffect, useState } from 'react';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface VisibleViewport {
  left: number;
  top: number;
  width: number;
  height: number;
  safeAreaInsets: SafeAreaInsets;
}

export interface ViewportSource {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: Pick<VisualViewport, 'offsetLeft' | 'offsetTop' | 'width' | 'height'> | null;
}

const EMPTY_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function getVisibleViewport(
  source?: ViewportSource,
  safeAreaInsets: SafeAreaInsets = EMPTY_INSETS
): VisibleViewport {
  const viewportSource = source ?? (typeof window === 'undefined' ? undefined : window);
  const visualViewport = viewportSource?.visualViewport;

  return {
    left: Math.max(0, visualViewport?.offsetLeft ?? 0),
    top: Math.max(0, visualViewport?.offsetTop ?? 0),
    width: Math.max(0, visualViewport?.width ?? viewportSource?.innerWidth ?? 0),
    height: Math.max(0, visualViewport?.height ?? viewportSource?.innerHeight ?? 0),
    safeAreaInsets,
  };
}

function getSafeAreaInsets(): SafeAreaInsets {
  if (typeof window === 'undefined' || typeof document === 'undefined') return EMPTY_INSETS;
  const styles = window.getComputedStyle(document.documentElement);
  const read = (name: string) => {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  };

  return {
    top: read('--safe-area-inset-top'),
    right: read('--safe-area-inset-right'),
    bottom: read('--safe-area-inset-bottom'),
    left: read('--safe-area-inset-left'),
  };
}

function readCurrentViewport(): VisibleViewport {
  return getVisibleViewport(
    typeof window === 'undefined' ? undefined : window,
    getSafeAreaInsets()
  );
}

function sameViewport(a: VisibleViewport, b: VisibleViewport): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.safeAreaInsets.top === b.safeAreaInsets.top &&
    a.safeAreaInsets.right === b.safeAreaInsets.right &&
    a.safeAreaInsets.bottom === b.safeAreaInsets.bottom &&
    a.safeAreaInsets.left === b.safeAreaInsets.left
  );
}

/** Tracks the visible browser viewport, which shrinks and may move when a mobile keyboard opens. */
export function useVisibleViewport(): VisibleViewport {
  const [viewport, setViewport] = useState<VisibleViewport>(readCurrentViewport);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = readCurrentViewport();
        setViewport((current) => (sameViewport(current, next) ? current : next));
      });
    };

    const visualViewport = window.visualViewport;
    window.addEventListener('resize', update);
    visualViewport?.addEventListener('resize', update);
    visualViewport?.addEventListener('scroll', update);
    update();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      visualViewport?.removeEventListener('resize', update);
      visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return viewport;
}
