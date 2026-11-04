'use client';

import React, { useEffect, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';

/** Shared AI identity; only live work animates. */
export function AIOrb({ size = 20, active = false, className, style }: {
  size?: number; active?: boolean; className?: string; style?: React.CSSProperties;
  strokeWidth?: number; 'aria-hidden'?: boolean | 'true' | 'false';
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      const preference = document.documentElement.dataset.appearance;
      setTheme(preference === 'dark' || (preference !== 'light' && media.matches) ? 'dark' : 'light');
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] });
    media.addEventListener('change', sync);
    return () => { observer.disconnect(); media.removeEventListener('change', sync); };
  }, []);
  return <span aria-hidden="true" className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...style }}>
    <ThinkingOrb size={size >= 36 ? 64 : 20} state={active ? 'composing' : 'breathing'} paused={!active} theme={theme} />
  </span>;
}
