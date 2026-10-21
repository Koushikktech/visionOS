'use client';

import dynamic from 'next/dynamic';

const Canvas = dynamic(() => import('@/components/Canvas'), {
  ssr: false,
  loading: () => (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center bg-[#08090d] select-none text-white overflow-hidden antialiased">
      {/* Background radial ambient glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(99,102,241,0.1)_0%,transparent_65%)] pointer-events-none" />

      {/* visionOS Spatial Glass Emblem */}
      <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-[24px] bg-white/[0.04] border border-white/10 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <div className="absolute inset-1 rounded-[20px] border border-white/5 bg-gradient-to-b from-white/[0.08] to-transparent pointer-events-none" />
        {/* Apple visionOS Spatial Rings Icon */}
        <div className="relative flex items-center justify-center">
          <div className="h-10 w-10 rounded-full border border-indigo-400/30 animate-ping opacity-20" />
          <div className="absolute h-8 w-8 rounded-full border border-white/20" />
          <div className="absolute h-3.5 w-3.5 rounded-full bg-gradient-to-tr from-indigo-400 to-cyan-300 shadow-[0_0_15px_rgba(129,140,248,0.5)]" />
        </div>
      </div>

      {/* Typography */}
      <div className="flex flex-col items-center gap-1.5 z-10 text-center">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold tracking-tight text-white/95">visionOS</span>
          <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/10">Spatial</span>
        </div>
        <p className="text-xs text-white/40 font-medium tracking-wide">
          Initializing Spatial Canvas Environment...
        </p>
      </div>

      {/* Apple Liquid Glass Indeterminate Progress Bar */}
      <div className="relative mt-7 h-1 w-44 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full w-20 rounded-full bg-gradient-to-r from-transparent via-indigo-400/80 to-transparent animate-[shimmer_1.5s_infinite]" />
      </div>
    </div>
  ),
});

export default function Home() {
  return <Canvas />;
}
