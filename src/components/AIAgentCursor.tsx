'use client';

import { AIOrb } from './AIOrb';


import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Bot } from 'lucide-react';
import type { AgentPresenceState, MultiAgentPresenceState } from '../types/spatial';

interface AIAgentCursorProps {
  presence?: AgentPresenceState;
  multiPresences?: MultiAgentPresenceState[];
}

const ROLE_COLORS: Record<string, { start: string; end: string; ring: string; ping: string; text: string }> = {
  'light-violet': { start: '#8b5cf6', end: '#d946ef', ring: 'border-purple-500/40', ping: 'bg-purple-400', text: 'text-purple-300' },
  'light-green': { start: '#10b981', end: '#06b6d4', ring: 'border-emerald-500/40', ping: 'bg-emerald-400', text: 'text-emerald-300' },
  'light-blue': { start: '#38bdf8', end: '#6366f1', ring: 'border-sky-500/40', ping: 'bg-sky-400', text: 'text-sky-300' },
  'yellow': { start: '#f59e0b', end: '#f97316', ring: 'border-amber-500/40', ping: 'bg-amber-400', text: 'text-amber-300' },
};

function SingleCursor({
  id,
  x,
  y,
  statusText,
  role,
  color = 'light-blue',
}: {
  id: string;
  x: number;
  y: number;
  statusText?: string;
  role?: string;
  color?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const theme = ROLE_COLORS[color] || ROLE_COLORS['light-blue'];
  const gradId = `agent-grad-${id}`;

  return (
    <motion.div
      key={id}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.5 }}
      animate={{
        opacity: 1,
        scale: 1,
        x,
        y,
      }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
      transition={reduceMotion ? { duration: 0 } : {
        type: 'spring',
        damping: 26,
        stiffness: 300,
        mass: 0.5,
      }}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        zIndex: 450,
      }}
      className="flex items-start gap-2 select-none"
    >
      {/* Glowing SVG Cursor Arrow with elegant Apple cursor shadow */}
      <div className="relative">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] filter"
        >
          <path
            d="M4.5 3.5L19.5 10.5L12 13L9.5 20.5L4.5 3.5Z"
            fill={`url(#${gradId})`}
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient id={gradId} x1="4.5" y1="3.5" x2="19.5" y2="20.5" gradientUnits="userSpaceOnUse">
              <stop stopColor={theme.start} />
              <stop offset="1" stopColor={theme.end} />
            </linearGradient>
          </defs>
        </svg>
        <span className="absolute -bottom-1 -right-1 flex h-2 w-2">
          {!reduceMotion && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${theme.ping} opacity-75`} />}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${theme.ping}`} />
        </span>
      </div>

      {/* Floating Live Speech Bubble Tooltip */}
      {(statusText || role) && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 5, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reduceMotion ? { duration: 0 } : undefined}
          className="flex items-center gap-1.5 rounded-full studio-agent-status border px-3 py-1 text-[11px] font-medium text-[var(--studio-text)] backdrop-blur-2xl antialiased"
        >
          <AIOrb className={`h-3 w-3 ${theme.text}`} strokeWidth={1.5} />
          {role && <span className="font-semibold text-[var(--studio-text)]">{role}:</span>}
          <span className="tracking-wide text-[var(--studio-secondary)] truncate max-w-[200px]">{statusText || 'Executing...'}</span>
        </motion.div>
      )}
    </motion.div>
  );
}

export const AIAgentCursor: React.FC<AIAgentCursorProps> = ({ presence, multiPresences }) => {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <AnimatePresence initial={!reduceMotion}>
      {/* Primary single presence */}
      {presence && presence.isActive && (
        <SingleCursor
          key="primary-agent-cursor"
          id="primary"
          x={presence.x}
          y={presence.y}
          statusText={presence.statusText}
          role={presence.role}
          color={presence.color || 'light-blue'}
        />
      )}

      {/* Multi-Agent Swarm presences */}
      {multiPresences &&
        multiPresences
          .filter((p) => p.isActive)
          .map((p) => (
            <SingleCursor
              key={p.agentId}
              id={p.agentId}
              x={p.x}
              y={p.y}
              statusText={p.statusText}
              role={p.role}
              color={p.color}
            />
          ))}
    </AnimatePresence>
  );
};
