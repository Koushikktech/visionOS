'use client';

import { useEffect, useState } from 'react';
import { BorderBeam } from 'border-beam';

/** Decorative edge only; the owning surface provides its real work state. */
export function GenerationGlow({ active, radius = 26 }: { active: boolean; radius?: number }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      const appearance = document.documentElement.dataset.appearance;
      setTheme(appearance === 'dark' || (appearance !== 'light' && media.matches) ? 'dark' : 'light');
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] });
    media.addEventListener('change', sync);
    return () => { observer.disconnect(); media.removeEventListener('change', sync); };
  }, []);
  if (!active) return null;
  return <div aria-hidden="true" className="studio-generation-glow">
    <BorderBeam active size="md" colorVariant="colorful" strength={theme === 'dark' ? 0.48 : 0.3} theme={theme} style={{ width: '100%', height: '100%', borderRadius: radius }}>
      <div style={{ width: '100%', height: '100%', borderRadius: radius }} />
    </BorderBeam>
  </div>;
}
