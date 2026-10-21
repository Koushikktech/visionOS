'use client';

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
  Zap,
  Square,
  Sliders,
  Check,
  Copy,
  Plus,
  ShieldCheck,
  Network,
  SquarePen,
  KeyRound,
  CheckCircle2,
  CircleDashed,
  Eye,
  Camera,
  Wand2,
  MessageSquare,
  LayoutGrid,
  Mic,
  MicOff,
  Maximize2,
  Minimize2,
  Brain,
  Trash2,
  Command,
  FileText,
  Cpu,
  Layers,
  Flame,
} from 'lucide-react';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { ThinkingOrb } from 'thinking-orbs';
import { BorderBeam } from 'border-beam';
import { VoiceBeam, useMicrophone } from 'voice-glow';
import type { useSpatialAI } from '../hooks/useSpatialAI';
import type { useSpatialWorker } from '../hooks/useSpatialWorker';
import type { DAGExecutionPlan, DAGExecutionNode } from '../types/spatial';

export interface SpatialAIOmnibarProps {
  ai: ReturnType<typeof useSpatialAI>;
  spatial?: ReturnType<typeof useSpatialWorker>;
}

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 3)}...${key.slice(-2)}`;
  return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
}

function renderChatMarkdownWithKaTeX(rawText: string): string {
  if (!rawText) return '';

  let processed = rawText;

  // Block math ($$...$$)
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    try {
      return `<div class="katex-block my-1.5 overflow-x-auto py-0.5">${katex.renderToString(
        math.trim(),
        {
          displayMode: true,
          throwOnError: false,
        }
      )}</div>`;
    } catch {
      return `<pre class="bg-black/40 p-2 rounded-xl text-red-300 font-mono text-xs border border-white/10">${math}</pre>`;
    }
  });

  // Inline math ($...$)
  processed = processed.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, math) => {
    try {
      return `<span class="katex-inline">${katex.renderToString(math.trim(), {
        displayMode: false,
        throwOnError: false,
      })}</span>`;
    } catch {
      return `<code class="bg-white/10 px-1 rounded text-red-300 font-mono">${math}</code>`;
    }
  });

  try {
    const rawHtml = marked.parse(processed) as string;
    if (typeof window !== 'undefined') {
      return DOMPurify.sanitize(rawHtml, {
        ADD_TAGS: [
          'annotation',
          'semantics',
          'math',
          'mrow',
          'mi',
          'mo',
          'mn',
          'msup',
          'msub',
          'mfrac',
          'mover',
          'munder',
          'msubsup',
          'mtext',
          'mspace',
          'mtable',
          'mtr',
          'mtd',
        ],
        ADD_ATTR: ['display', 'xmlns'],
      });
    }
    return rawHtml;
  } catch {
    return processed.replace(/\n/g, '<br/>');
  }
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      onClick={handleCopy}
      type="button"
      title={copied ? 'Copied to clipboard' : 'Copy message text'}
      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all shrink-0"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
      ) : (
        <Copy className="h-4 w-4" strokeWidth={1.5} />
      )}
    </button>
  );
}

function formatDisplayActionBadge(raw: string): string {
  if (!raw) return 'Action Completed';
  let clean = raw.trim();

  // Strip shape:app_... or shape:... UUIDs
  clean = clean.replace(/shape:(?:app_|card_|doc_|deck_|box_|vector_)?[a-f0-9-]+/gi, (match) => {
    if (/app_/i.test(match)) return 'Live App';
    if (/card_/i.test(match)) return 'Note';
    if (/doc_/i.test(match)) return 'Doc';
    if (/deck_/i.test(match)) return 'Slides';
    return 'Element';
  });

  // Strip standalone UUIDs
  clean = clean.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '');

  // Compress repetitive prefixes
  clean = clean.replace(/^focus viewport:?\s*/i, 'Focus: ');
  clean = clean.replace(/^spawn artifact:?\s*/i, 'Created App: ');
  clean = clean.replace(/^mutate artifact:?\s*/i, 'Updated App: ');
  clean = clean.replace(/^create rich card:?\s*/i, 'Created Note: ');
  clean = clean.replace(/^mutate rich card:?\s*/i, 'Updated Note: ');
  clean = clean.replace(/^create code card:?\s*/i, 'Created Code: ');
  clean = clean.replace(/^create document:?\s*/i, 'Created Doc: ');
  clean = clean.replace(/^create slide deck:?\s*/i, 'Created Slides: ');

  // Clean trailing punctuation or spaces
  clean = clean.replace(/[:,\s]+$/, '').trim();
  if (clean.length > 40) {
    clean = clean.slice(0, 37) + '...';
  }
  return clean || 'Canvas Updated';
}

function VisionThinkingAccordion({
  thought,
  durationMs,
  isStreaming,
}: {
  thought: string;
  durationMs?: number;
  isStreaming?: boolean;
}) {
  const [userToggled, setUserToggled] = useState(false);
  const [isExpanded, setIsExpanded] = useState(() => Boolean(isStreaming));

  useEffect(() => {
    if (isStreaming && !userToggled) {
      setIsExpanded(true);
    }
  }, [isStreaming, userToggled]);

  if (!thought) return null;

  return (
    <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md overflow-hidden text-xs transition-all">
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setIsExpanded(!isExpanded);
        }}
        className="w-full min-h-[40px] flex items-center justify-between px-3.5 py-2 bg-white/[0.02] hover:bg-white/[0.05] active:scale-[0.96] transition-all text-white/80"
      >
        <div className="flex items-center gap-2 font-medium">
          <ThinkingOrb
            size={20}
            state={isStreaming ? 'solving' : 'breathing'}
            theme="dark"
          />
          <span className="font-semibold text-[11px] text-white/90">
            Reasoning Chain
          </span>
          {durationMs !== undefined && durationMs > 0 && (
            <span className="text-[10px] text-white/50 font-mono tabular-nums">
              ({(durationMs / 1000).toFixed(1)}s)
            </span>
          )}
          {isStreaming && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-mono text-white/80 border border-white/10">
              Thinking
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-white/50" strokeWidth={2.0} />
        ) : (
          <ChevronDown className="h-4 w-4 text-white/50" strokeWidth={2.0} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="p-3 text-[11px] font-mono leading-relaxed text-white/70 whitespace-pre-wrap max-h-56 overflow-y-auto border-t border-white/10 bg-black/40 custom-card-scrollbar select-text cursor-text"
          >
            {thought}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ROTATING_THINKING_PHRASES = [
  'Thinking...',
  'Pondering spatial topology...',
  'Synthesizing UI components...',
  'Refining layout & design...',
  'Architecting interactive logic...',
  'Validating spatial constraints...',
];

function VisionRotatingThinkingIndicator() {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % ROTATING_THINKING_PHRASES.length);
    }, 2200);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2.5 py-2 px-1 text-white/70 select-none">
      <div className="flex h-5 w-5 items-center justify-center shrink-0">
        <ThinkingOrb size={20} state="solving" theme="dark" />
      </div>
      <AnimatePresence mode="wait">
        <motion.span
          key={phraseIndex}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="text-xs font-medium text-slate-300 font-sans tracking-wide"
        >
          {ROTATING_THINKING_PHRASES[phraseIndex]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function VisionDAGPlanTree({
  plan,
  nodes,
}: {
  plan?: DAGExecutionPlan;
  nodes?: DAGExecutionNode[];
}) {
  if (!plan && (!nodes || nodes.length === 0)) return null;

  const displayNodes = nodes && nodes.length > 0 ? nodes : plan?.nodes || [];

  return (
    <div className="mb-2.5 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-3 text-xs shadow-md">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 text-white/90 font-semibold text-[11px]">
          <Network className="h-4 w-4 text-white/70" strokeWidth={1.5} />
          <span>Swarm Task Plan: {plan?.title || 'Execution DAG'}</span>
        </div>
        <span className="text-[9px] font-mono tabular-nums text-white/60 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
          Parallel Workers
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {displayNodes.map((n) => {
          const isDone = n.status === 'completed';
          const isStreaming = n.status === 'streaming';

          return (
            <div
              key={n.id}
              className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-[11px] transition-all ${
                isDone
                  ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                  : isStreaming
                    ? 'border-white/20 bg-white/10 text-white animate-pulse'
                    : 'border-white/10 bg-white/5 text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                {isDone ? (
                  <CheckCircle2
                    className="h-4 w-4 text-emerald-400 shrink-0"
                    strokeWidth={1.5}
                  />
                ) : isStreaming ? (
                  <Loader2
                    className="h-4 w-4 text-white animate-spin shrink-0"
                    strokeWidth={1.5}
                  />
                ) : (
                  <CircleDashed
                    className="h-4 w-4 text-slate-500 shrink-0"
                    strokeWidth={1.5}
                  />
                )}
                <span className="truncate font-medium">
                  {'title' in n && n.title
                    ? n.title
                    : 'label' in n && n.label
                      ? n.label
                      : n.id}
                </span>
              </div>
              <span className="text-[9px] font-mono opacity-70 shrink-0 uppercase tracking-wider">
                {n.modality}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const SpatialAIOmnibar: React.FC<SpatialAIOmnibarProps> = ({ ai }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  // Settings State
  const [modelInput, setModelInput] = useState('');
  const [newKeyInput, setNewKeyInput] = useState('');
  const [isAddingKey, setIsAddingKey] = useState(false);

  // Voice Dictation with Web Speech API & Voice Glow
  const mic = useMicrophone();
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isMicLive = mic.state === 'live' || isListening;

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  // Click outside to dismiss Action Menu popover
  useEffect(() => {
    if (!showActionMenu) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const isInside =
        actionMenuRef.current &&
        (actionMenuRef.current.contains(target) ||
          (e.composedPath && e.composedPath().includes(actionMenuRef.current)));

      if (!isInside) {
        setShowActionMenu(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, {
      capture: true,
    });
    window.addEventListener('click', handlePointerDown, { capture: true });

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, {
        capture: true,
      });
      window.removeEventListener('click', handlePointerDown, { capture: true });
    };
  }, [showActionMenu]);

  // Keyboard shortcut: Cmd+K / Ctrl+K / / opens Omnibar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        setIsOpen(true);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setShowActionMenu(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  // Sync model input state
  useEffect(() => {
    setModelInput(ai.activeModel);
  }, [ai.activeModel]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!isUserScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [ai.messages, isUserScrolledUp]);

  const handleScroll = () => {
    if (!chatScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
    setIsUserScrolledUp(!isAtBottom);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsUserScrolledUp(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || ai.isGenerating) return;
    ai.sendMessage(inputText.trim());
    setInputText('');
    setIsUserScrolledUp(false);
  };

  const handleNewChat = () => {
    ai.clearChat();
    setIsUserScrolledUp(false);
    setShowSettings(false);
    setShowActionMenu(false);
  };

  const handleActionPreset = (presetPrompt: string) => {
    ai.sendMessage(presetPrompt);
    setShowActionMenu(false);
    setIsUserScrolledUp(false);
  };

  const startVoice = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        mic.start().catch(() => {});
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setInputText(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('[visionOS] Speech recognition error:', event.error);
        if (event.error !== 'no-speech') {
          setIsListening(false);
          mic.stop();
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        mic.stop();
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('[visionOS] Speech recognition failed to start:', err);
      setIsListening(false);
      mic.stop();
    }
  }, [mic]);

  const stopVoice = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
    mic.stop();
  }, [mic]);

  const toggleVoice = useCallback(() => {
    if (isListening || mic.state === 'live') {
      stopVoice();
    } else {
      startVoice();
    }
  }, [isListening, mic.state, startVoice, stopVoice]);

  const handleSaveModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelInput.trim()) return;
    if (ai.provider === 'openrouter') {
      ai.setOpenRouterModel(modelInput.trim());
    } else {
      ai.setGeminiModel(modelInput.trim());
    }
  };

  const handleAddKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyInput.trim()) return;
    if (ai.provider === 'openrouter') {
      ai.addOpenRouterKey(newKeyInput.trim());
    } else {
      ai.addGeminiKey(newKeyInput.trim());
    }
    setNewKeyInput('');
    setIsAddingKey(false);
  };

  const handleRemoveKey = (key: string) => {
    if (ai.provider === 'openrouter') {
      ai.removeOpenRouterKey(key);
    } else {
      ai.removeGeminiKey(key);
    }
  };

  const activeKeys =
    ai.provider === 'openrouter' ? ai.openRouterApiKeys : ai.geminiApiKeys;

  const quickStarters = [
    {
      label: '✨ Make Real: Sketch to App',
      prompt:
        'Make Real: Turn the selected sketch/wireframe into an interactive, responsive live app with persistent storage.',
      icon: Wand2,
    },
    {
      label: '⚡ Microservices Architecture',
      prompt:
        'Build a distributed microservices cloud architecture on canvas with API Gateway, Auth Microservice, Redis Message Queue, and PostgreSQL Database cylinder, connecting them with labeled arrows.',
      icon: Cpu,
    },
    {
      label: '📑 Whitepaper Document Spec',
      prompt:
        'Create a comprehensive technical document specification for a distributed Byzantine Fault Tolerant consensus engine, including Executive Summary, Mathematical Foundations, and Network Architecture sections.',
      icon: FileText,
    },
    {
      label: '🎮 Physics Simulation Sandbox',
      prompt:
        'Spawn an interactive live physics sandbox with particle gravity simulation and velocity controls with persistent storage.',
      icon: Flame,
    },
    {
      label: '📊 2x2 Strategic SWOT Matrix',
      prompt:
        'Generate a comprehensive 2x2 SWOT Strategic Analysis matrix with color-coded quadrants.',
      icon: Layers,
    },
  ];

  return (
    <>
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 1. Floating Bottom-Right visionOS Omnibar Trigger Pill (Desktop HUD) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-[300] pointer-events-auto select-none">
          <motion.button
            onClick={() => setIsOpen(true)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            className="flex items-center gap-3 rounded-full liquid-glass-pill px-4 py-2 border border-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.16)] text-white hover:border-white/25 transition-all antialiased backdrop-blur-3xl"
          >
            <div className="flex h-6 w-6 items-center justify-center">
              <ThinkingOrb size={20} state="breathing" theme="dark" />
            </div>
            <span className="text-xs font-medium text-slate-200">
              Ask visionOS Spatial AI...
            </span>
            <kbd className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-mono tabular-nums text-slate-300">
              <Command className="h-3 w-3" strokeWidth={1.5} /> K
            </kbd>
          </motion.button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 2. visionOS Spatial Intelligence Liquid Glass Panel                 */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <aside
            aria-label="visionOS Spatial Intelligence Panel"
            data-visionos-panel="true"
            className="fixed bottom-6 right-6 z-[350] flex flex-col items-end pointer-events-auto select-none"
          >
            <motion.div
              style={{
                width: isExpanded ? 580 : 420,
                height: isExpanded ? 760 : 580,
              }}
              initial={{
                opacity: 0,
                y: 20,
                scale: 0.96,
                width: isExpanded ? 580 : 420,
                height: isExpanded ? 760 : 580,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                width: isExpanded ? 580 : 420,
                height: isExpanded ? 760 : 580,
              }}
              exit={{
                opacity: 0,
                y: 20,
                scale: 0.96,
                transition: { duration: 0.2, ease: [0.2, 0, 0, 1] },
              }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
              className="relative flex flex-col rounded-[32px] w-[420px] max-w-[calc(100vw-3rem)] h-[580px] max-h-[calc(100vh-5rem)] liquid-glass-siri overflow-hidden antialiased text-white"
            >
              {/* 1px Specular Top Highlight */}
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />

              {/* ── Top Bar with Circular Controls ── */}
              <header className="flex h-14 shrink-0 items-center justify-between px-4 border-b border-white/[0.08] bg-white/[0.03]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center shrink-0">
                    <ThinkingOrb
                      size={20}
                      state={ai.isGenerating ? 'solving' : 'breathing'}
                      theme="dark"
                    />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-xs text-white tracking-wide truncate">
                      Spatial Intelligence
                    </h2>
                    <p className="text-[10px] text-white/50 font-mono tabular-nums truncate tracking-tight">
                      {ai.activeModel}
                    </p>
                  </div>
                </div>

                {/* Circular Top Controls (Touch Targets >= 40x40px, Scale 0.96) */}
                <div className="flex items-center gap-1">
                  {/* New Chat Button */}
                  <button
                    type="button"
                    onClick={handleNewChat}
                    title="Start New Chat"
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all"
                  >
                    <SquarePen className="h-4 w-4" strokeWidth={1.5} />
                  </button>

                  {/* Settings Toggle Button */}
                  <button
                    type="button"
                    onClick={() => setShowSettings(!showSettings)}
                    title="Model & Key Settings"
                    className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full active:scale-[0.96] transition-all ${
                      showSettings
                        ? 'text-white bg-white/15'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Sliders className="h-4 w-4" strokeWidth={1.5} />
                  </button>

                  {/* Expand / Collapse Button */}
                  <button
                    type="button"
                    onClick={() => setIsExpanded(!isExpanded)}
                    title={isExpanded ? 'Collapse size' : 'Expand size'}
                    className="min-w-[40px] min-h-[40px] hidden sm:flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all"
                  >
                    {isExpanded ? (
                      <Minimize2 className="h-4 w-4" strokeWidth={1.5} />
                    ) : (
                      <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
                    )}
                  </button>

                  {/* Close / Dismiss Button */}
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    title="Close Spatial AI"
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              </header>

              {/* ── Settings Drawer (When Activated) ── */}
              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-b border-white/[0.08] bg-white/[0.03] backdrop-blur-3xl p-4 text-xs overflow-hidden"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-semibold text-white/90">
                        Inference Provider
                      </span>
                      <div className="flex rounded-full bg-white/5 p-0.5 border border-white/10">
                        <button
                          type="button"
                          onClick={() => ai.setProvider('gemini')}
                          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all active:scale-[0.96] ${
                            ai.provider === 'gemini'
                              ? 'bg-white/20 text-white shadow-sm'
                              : 'text-white/50 hover:text-white'
                          }`}
                        >
                          Gemini
                        </button>
                        <button
                          type="button"
                          onClick={() => ai.setProvider('openrouter')}
                          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all active:scale-[0.96] ${
                            ai.provider === 'openrouter'
                              ? 'bg-white/20 text-white shadow-sm'
                              : 'text-white/50 hover:text-white'
                          }`}
                        >
                          OpenRouter
                        </button>
                      </div>
                    </div>

                    {/* Model Quick Select Presets */}
                    {ai.provider === 'gemini' && (
                      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                        {['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-4-argon'].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              setModelInput(preset);
                              ai.setGeminiModel(preset);
                            }}
                            className={`text-[10px] px-2.5 py-1 rounded-full font-mono border transition-all active:scale-[0.96] ${
                              ai.activeModel === preset
                                ? 'bg-indigo-500/25 border-indigo-400/40 text-indigo-200'
                                : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Active Model Customizer */}
                    <form
                      onSubmit={handleSaveModel}
                      className="mb-3 flex gap-2"
                    >
                      <input
                        type="text"
                        value={modelInput}
                        onChange={(e) => setModelInput(e.target.value)}
                        placeholder="Model identifier..."
                        className="flex-1 min-h-[40px] rounded-xl bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white font-mono placeholder-white/30 outline-none focus:border-white/30"
                      />
                      <button
                        type="submit"
                        className="min-h-[40px] px-3.5 rounded-xl bg-white/10 hover:bg-white/20 active:scale-[0.96] text-white text-xs font-medium border border-white/10 transition-all"
                      >
                        Save
                      </button>
                    </form>

                    <p className="text-xs text-white/70 mb-2">
                      Keys added here are saved in this browser. Private
                      deployments can use server environment keys.
                    </p>
                    {/* Key Management */}
                    <div className="space-y-1.5 max-h-28 overflow-y-auto custom-card-scrollbar">
                      {activeKeys.map((k) => (
                        <div
                          key={k}
                          className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[11px] font-mono text-white/70"
                        >
                          <span>{maskApiKey(k)}</span>
                          <button
                            type="button"
                            aria-label="Remove API key"
                            onClick={() => handleRemoveKey(k)}
                            className="min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center rounded-lg text-white/40 hover:text-rose-400 hover:bg-white/10 active:scale-[0.96] transition-all p-1"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </div>
                      ))}
                    </div>

                    {isAddingKey ? (
                      <form onSubmit={handleAddKey} className="mt-2 flex gap-2">
                        <input
                          type="password"
                          value={newKeyInput}
                          onChange={(e) => setNewKeyInput(e.target.value)}
                          aria-label="API key"
                          placeholder="Paste API Key..."
                          className="flex-1 min-h-[40px] rounded-xl bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white font-mono outline-none"
                        />
                        <button
                          type="submit"
                          className="min-h-[40px] px-3.5 rounded-xl bg-white/15 hover:bg-white/25 active:scale-[0.96] text-white text-xs font-medium transition-all"
                        >
                          Add
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsAddingKey(true)}
                        className="mt-2 min-h-[40px] px-2.5 rounded-xl text-[11px] text-white/50 hover:text-white hover:bg-white/5 flex items-center gap-1 transition-all active:scale-[0.96]"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                        <span>Add API Key</span>
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Scrollable Chat Content ── */}
              {ai.storageWarning && (
                <p role="alert" className="px-4 py-2 text-xs text-amber-200">
                  {ai.storageWarning}
                </p>
              )}
              <div
                ref={chatScrollRef}
                onScroll={handleScroll}
                className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 custom-card-scrollbar select-text"
              >
                {/* Empty State: Quick Prompt Starters */}
                {ai.messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center min-h-[300px] text-center p-4 gap-4">
                    <div className="flex h-12 w-12 items-center justify-center">
                      <ThinkingOrb size={64} state="breathing" theme="dark" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-white">
                        How can I help you create?
                      </h3>
                      <p className="text-xs text-white/50 mt-1 max-w-[280px]">
                        CanvasOS Spatial Intelligence generates shapes, apps,
                        and documents right on your canvas.
                      </p>
                    </div>

                    <div className="w-full space-y-2 mt-2">
                      {quickStarters.map((item, idx) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleActionPreset(item.prompt)}
                            className="w-full flex items-center gap-2.5 p-3 rounded-[24px] bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.96] border border-white/[0.08] text-left transition-all group"
                          >
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/10 text-white shrink-0">
                              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </div>
                            <span className="text-xs font-medium text-white/80 group-hover:text-white truncate">
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Message List */}
                {ai.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} gap-1`}
                  >
                    {msg.role === 'user' ? (
                      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-white/15 border border-white/10 px-4 py-3 text-xs leading-relaxed text-white shadow-md">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="w-full rounded-2xl bg-white/[0.04] border border-white/10 p-4 text-xs text-white/90 shadow-md">
                        {/* Assistant Header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <ThinkingOrb
                              size={20}
                              state={msg.isStreaming ? 'solving' : 'breathing'}
                              theme="dark"
                            />
                            <span className="font-semibold text-[11px] text-white">
                              Spatial Intelligence
                            </span>
                          </div>
                          <CopyMessageButton text={msg.content} />
                        </div>

                        {/* Thought Process Accordion */}
                        {msg.thought && (
                          <VisionThinkingAccordion
                            thought={msg.thought}
                            durationMs={msg.thoughtDurationMs}
                            isStreaming={msg.isStreaming}
                          />
                        )}

                        {/* Rotating thinking state when streaming before content arrives */}
                        {msg.isStreaming &&
                          (!msg.content || msg.content.trim().length === 0) &&
                          !msg.thought && <VisionRotatingThinkingIndicator />}

                        {/* Swarm DAG Plan if present */}
                        {(msg.dagPlan ||
                          (msg.dagNodes && msg.dagNodes.length > 0)) && (
                          <VisionDAGPlanTree
                            plan={msg.dagPlan}
                            nodes={msg.dagNodes}
                          />
                        )}

                        {/* Message Markdown Content */}
                        {msg.content && msg.content.trim().length > 0 && (
                          <div
                            className="rich-card-prose prose prose-invert prose-sm max-w-none text-xs leading-relaxed"
                            dangerouslySetInnerHTML={{
                              __html: renderChatMarkdownWithKaTeX(msg.content),
                            }}
                          />
                        )}

                        {/* Executed Action Badges (Apple Liquid Glass Pills) */}
                        {msg.executedActions &&
                          msg.executedActions.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-white/[0.08]">
                              {msg.executedActions.map((act, i) => (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const id =
                                      act.rawFrame.target ||
                                      act.rawFrame.id ||
                                      act.rawFrame.nodeIds?.[0];
                                    if (id) ai.focusOnShape(id);
                                  }}
                                  title="Show affected element on canvas"
                                  key={i}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 active:scale-[0.96] text-[11px] text-white/80 font-medium transition-all"
                                >
                                  <span className="text-cyan-400">✦</span>
                                  <span>{formatDisplayActionBadge(act.actionSummary)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                ))}

                <div ref={messagesEndRef} />
              </div>

              <div role="status" aria-live="polite" className="sr-only">
                {ai.isGenerating
                  ? ai.isMakingReal
                    ? 'Generating app'
                    : 'Preparing response'
                  : 'Ready'}
              </div>
              {/* ── Bottom Input & Intelligence Controls ── */}
              <div
                ref={actionMenuRef}
                className="relative border-t border-white/[0.08] bg-white/[0.02] p-3 space-y-2"
              >
                {/* ── Intelligence Toggles: Thinking & Swarm ── */}
                <div className="flex items-center gap-1.5 px-1">
                  {/* Thinking Mode Pill */}
                  <button
                    type="button"
                    onClick={() => ai.setThinkingMode(!ai.thinkingMode)}
                    title={
                      ai.thinkingMode
                        ? 'Deep reasoning enabled'
                        : 'Standard fast inference'
                    }
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all active:scale-[0.96] ${
                      ai.thinkingMode
                        ? 'bg-white/15 text-white border-white/25 shadow-sm'
                        : 'bg-white/[0.03] text-white/50 hover:text-white/80 border-white/[0.08] hover:bg-white/[0.06]'
                    }`}
                  >
                    <Brain
                      className={`h-3 w-3 ${ai.thinkingMode ? 'text-cyan-300' : 'text-white/40'}`}
                      strokeWidth={1.5}
                    />
                    <span>Thinking</span>
                  </button>

                  {/* Swarm (Coming Soon) */}
                  <div
                    title="Swarm (Multi-Agent Specialist Collaboration) is coming soon in an upcoming visionOS update"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/[0.03] text-white/40 border border-white/[0.06] cursor-not-allowed select-none"
                  >
                    <Network
                      className="h-3 w-3 text-white/30"
                      strokeWidth={1.5}
                    />
                    <span>Swarm</span>
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded-full bg-indigo-500/15 text-indigo-300/80 border border-indigo-500/20 font-medium ml-0.5">Soon</span>
                  </div>
                </div>

                {/* ── Action Menu Popover (When + is Pressed) ── */}
                <AnimatePresence>
                  {showActionMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute bottom-20 left-4 z-50 w-72 rounded-[20px] bg-[rgba(24,24,32,0.95)] backdrop-blur-3xl border border-white/10 p-2 shadow-2xl space-y-1"
                    >
                      {quickStarters.map((item, idx) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleActionPreset(item.prompt)}
                            className="w-full flex items-center gap-2.5 min-h-[40px] px-3 py-2.5 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all"
                          >
                            <Icon
                              className="h-4 w-4 text-white/60 shrink-0"
                              strokeWidth={1.5}
                            />
                            <span className="truncate">{item.label}</span>
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ── Bottom Floating Input Pill (visionOS Style) ── */}
                <BorderBeam
                  size="line"
                  active={ai.isGenerating}
                  className="w-full rounded-full"
                >
                  <form
                    onSubmit={handleSubmit}
                    className="flex items-center gap-1.5 w-full rounded-full bg-white/[0.08] border border-white/10 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-2xl transition-colors focus-within:border-white/30"
                  >
                    {/* Action Menu (+) Button (Touch target >= 40x40px, Scale 0.96) */}
                    <button
                      type="button"
                      onClick={() => setShowActionMenu(!showActionMenu)}
                      title="Quick Action Presets"
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all shrink-0"
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.5} />
                    </button>

                    {/* Pill Text Input */}
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={
                        ai.groundedContext.selectedCount > 0
                          ? `Ask AI about selected shapes, 'Make Real'..."`
                          : 'Ask visionOS Spatial AI...'
                      }
                      disabled={ai.isGenerating || ai.isMakingReal}
                      className="flex-1 bg-transparent px-2 text-xs text-white placeholder-white/40 !outline-none font-sans"
                    />

                    {/* Voice Dictation Button with VoiceBeam */}
                    <VoiceBeam stream={mic.stream}>
                      <button
                        type="button"
                        onClick={toggleVoice}
                        title={
                          isMicLive ? 'Stop microphone' : 'Start voice input'
                        }
                        className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full transition-all active:scale-[0.96] shrink-0 ${
                          isMicLive
                            ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40'
                            : 'text-white/60 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {isMicLive ? (
                          <MicOff
                            className="h-4 w-4 text-rose-300"
                            strokeWidth={1.5}
                          />
                        ) : (
                          <Mic className="h-4 w-4" strokeWidth={1.5} />
                        )}
                      </button>
                    </VoiceBeam>

                    {/* Send / Stop Action Button (Touch target >= 40x40px, Scale 0.96) */}
                    {ai.isGenerating ? (
                      <button
                        type="button"
                        onClick={ai.stopGeneration}
                        title="Stop generation"
                        aria-label="Stop generation"
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full bg-rose-600 hover:bg-rose-500 text-white active:scale-[0.96] transition-all shrink-0"
                      >
                        <Square
                          className="h-4 w-4 fill-current"
                          strokeWidth={1.5}
                        />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!inputText.trim()}
                        title="Send prompt"
                        aria-label="Send prompt"
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/30 active:scale-[0.96] transition-all shadow-md shrink-0"
                      >
                        <Send className="h-4 w-4" strokeWidth={2.0} />
                      </button>
                    )}
                  </form>
                </BorderBeam>
              </div>
            </motion.div>
          </aside>
        )}
      </AnimatePresence>
    </>
  );
};
