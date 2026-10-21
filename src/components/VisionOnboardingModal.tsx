'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Key,
  Layers,
  Wand2,
  ExternalLink,
  Check,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Eye,
  EyeOff,
  Compass,
  X,
} from 'lucide-react';
import { createShapeId, type Editor } from '@tldraw/tldraw';

export interface VisionOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  geminiKeys: string[];
  onSaveGeminiKey: (key: string) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  editor: Editor | null;
}

export const GEMINI_MODEL_PRESETS = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    tag: 'Recommended',
    description: 'High-speed multimodal production model with fast spatial execution.',
    badge: 'Fast & Versatile',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    tag: 'Ultra-Fast',
    description: 'Cost-effective, rapid model built for high-throughput interactions.',
    badge: 'Lightweight',
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    tag: 'Frontier Reasoning',
    description: 'Advanced multi-step reasoning for complex UI architectures and deep logic.',
    badge: 'Deep Logic',
  },
];

export function VisionOnboardingModal({
  isOpen,
  onClose,
  geminiKeys,
  onSaveGeminiKey,
  selectedModel,
  onSelectModel,
  editor,
}: VisionOnboardingModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKeyText, setShowKeyText] = useState(false);
  const [chosenModel, setChosenModel] = useState<string>(() => {
    if (
      selectedModel &&
      selectedModel !== 'gemini' &&
      GEMINI_MODEL_PRESETS.some((p) => p.id === selectedModel)
    ) {
      return selectedModel;
    }
    return 'gemini-3.8-flash';
  });
  const [isKeySaved, setIsKeySaved] = useState(geminiKeys.length > 0);

  useEffect(() => {
    if (geminiKeys.length > 0) {
      setIsKeySaved(true);
    }
  }, [geminiKeys]);

  useEffect(() => {
    if (
      selectedModel &&
      selectedModel !== 'gemini' &&
      GEMINI_MODEL_PRESETS.some((p) => p.id === selectedModel)
    ) {
      setChosenModel(selectedModel);
    }
  }, [selectedModel]);

  const handleSaveKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    onSaveGeminiKey(trimmed);
    onSelectModel(chosenModel);
    setIsKeySaved(true);
  };

  const handleSelectPreset = (modelId: string) => {
    setChosenModel(modelId);
    onSelectModel(modelId);
  };

  const handleFinish = (stampSample: boolean) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('visionos_onboarded_v1', 'true');
    }
    onSelectModel(chosenModel);

    if (stampSample && editor) {
      try {
        const shapes = editor.getCurrentPageShapes();
        if (shapes.length === 0) {
          // Stamp clean starter playground
          editor.createShapes([
            {
              id: createShapeId('welcome_note'),
              type: 'rich_card',
              x: 120,
              y: 140,
              props: {
                title: 'Welcome to visionOS',
                content:
                  '### ✨ Spatial Infinite Canvas\n\n' +
                  '- **Draw & Arrange**: Use the bottom Island Dock to create cards, shapes, or diagrams.\n' +
                  '- **Vision Intelligence**: Press **⌘K** to ask the assistant to generate or restyle components.\n' +
                  '- **Make Real**: Select any wireframe and click *Make Real* to synthesize a live running app.',
                archetype: 'concept',
                w: 360,
                h: 240,
              },
            },
            {
              id: createShapeId('sample_calculator'),
              type: 'artifact',
              x: 540,
              y: 140,
              props: {
                title: 'Spatial Calculator',
                code: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#0b0e1c] text-white p-4 font-sans flex flex-col items-center justify-center min-h-screen select-none">
  <div class="w-full max-w-xs bg-white/[0.04] backdrop-blur-2xl border border-white/10 rounded-2xl p-4 shadow-2xl">
    <div id="display" class="w-full h-14 bg-black/40 rounded-xl px-3 flex items-center justify-end text-2xl font-mono tabular-nums text-indigo-200 mb-3 border border-white/5">0</div>
    <div class="grid grid-cols-4 gap-2">
      <button onclick="clearDisplay()" class="p-3 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 font-semibold text-rose-400">C</button>
      <button onclick="appendOp('/')" class="p-3 rounded-xl bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 active:scale-95 font-semibold">÷</button>
      <button onclick="appendOp('*')" class="p-3 rounded-xl bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 active:scale-95 font-semibold">×</button>
      <button onclick="appendOp('-')" class="p-3 rounded-xl bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 active:scale-95 font-semibold">−</button>
      <button onclick="appendNum('7')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">7</button>
      <button onclick="appendNum('8')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">8</button>
      <button onclick="appendNum('9')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">9</button>
      <button onclick="appendOp('+')" class="p-3 rounded-xl bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 active:scale-95 font-semibold">+</button>
      <button onclick="appendNum('4')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">4</button>
      <button onclick="appendNum('5')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">5</button>
      <button onclick="appendNum('6')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">6</button>
      <button onclick="calculate()" class="row-span-2 p-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 font-semibold text-white flex items-center justify-center">=</button>
      <button onclick="appendNum('1')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">1</button>
      <button onclick="appendNum('2')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">2</button>
      <button onclick="appendNum('3')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">3</button>
      <button onclick="appendNum('0')" class="col-span-2 p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">0</button>
      <button onclick="appendNum('.')" class="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 font-semibold">.</button>
    </div>
  </div>
  <script>
    let d = document.getElementById('display');
    let expr = '';
    function appendNum(n) { if (expr === '0' && n !== '.') expr = ''; expr += n; d.innerText = expr || '0'; }
    function appendOp(op) { if (!expr) return; expr += op; d.innerText = expr; }
    function clearDisplay() { expr = ''; d.innerText = '0'; }
    function calculate() { try { expr = String(eval(expr) || '0'); d.innerText = expr; } catch { d.innerText = 'Err'; expr = ''; } }
  </script>
</body>
</html>`,
                w: 420,
                h: 460,
              },
            },
          ]);
          editor.zoomToFit({ animation: { duration: 300 } });
        }
      } catch (err) {
        console.warn('[visionOS] Starter sample canvas error:', err);
      }
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md select-none antialiased">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 16 }}
          transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
          className="relative w-full max-w-xl rounded-[28px] bg-[rgba(18,18,24,0.92)] border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.12)] p-6 text-white backdrop-blur-3xl overflow-hidden"
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-white/95">visionOS</span>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/10">
                Setup & Tour
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-white/40 font-mono">
                <span className={`h-1.5 w-1.5 rounded-full ${step >= 1 ? 'bg-indigo-400' : 'bg-white/20'}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${step >= 2 ? 'bg-indigo-400' : 'bg-white/20'}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${step >= 3 ? 'bg-indigo-400' : 'bg-white/20'}`} />
              </div>
              <button
                type="button"
                onClick={() => handleFinish(false)}
                title="Dismiss"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* Step 1: Welcome & Overview */}
          {step === 1 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="mt-5 space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">
                  Welcome to visionOS Spatial Canvas
                </h2>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">
                  An infinite spatial playground combining freeform canvas sketching with vision-aware generative intelligence.
                </p>
              </div>

              <div className="space-y-2.5 pt-2">
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
                  <div className="h-8 w-8 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shrink-0">
                    <Layers className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">Infinite Spatial Canvas</h4>
                    <p className="text-[11px] text-white/60 mt-0.5 leading-relaxed">
                      Pan, zoom, sketch diagrams, write notes, craft multi-slide presentations, and structured documents.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
                  <div className="h-8 w-8 rounded-xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center text-cyan-400 shrink-0">
                    <Wand2 className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">Spatial Intelligence (⌘K)</h4>
                    <p className="text-[11px] text-white/60 mt-0.5 leading-relaxed">
                      Context-aware assistant that understands what you have selected, synthesizes UI, and arranges your canvas layout.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
                  <div className="h-8 w-8 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
                    <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">Make Real / Live App Sandbox</h4>
                    <p className="text-[11px] text-white/60 mt-0.5 leading-relaxed">
                      Draw a wireframe or UI concept, select it, and turn it into a running interactive HTML5/CSS/JS application with persistent virtual storage.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="min-h-[44px] px-5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium inline-flex items-center gap-2 active:scale-[0.96] transition-all shadow-lg shadow-indigo-500/20"
                >
                  <span>Connect Gemini AI</span>
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 2: API Key & Model Presets */}
          {step === 2 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="mt-5 space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">
                  Connect Google Gemini
                </h2>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">
                  visionOS operates client-side in your browser. Connect a Gemini API key to power spatial synthesis, code generation, and live app creation.
                </p>
              </div>

              {/* Client-Side Privacy Guarantee */}
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" strokeWidth={1.5} />
                <span>
                  <strong>100% Client-Side Privacy:</strong> Your key is saved strictly in your browser&apos;s local storage. It is never logged or stored on any remote database.
                </span>
              </div>

              {/* Get Key Link */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
                <div className="text-xs">
                  <span className="font-semibold text-white">Don&apos;t have an API key?</span>
                  <p className="text-[11px] text-white/50">Google AI Studio provides free developer keys in seconds.</p>
                </div>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[40px] px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-[0.96] text-white text-xs font-medium inline-flex items-center gap-1.5 transition-all"
                >
                  <span>Get Free Key</span>
                  <ExternalLink className="h-3 w-3 text-white/70" strokeWidth={1.5} />
                </a>
              </div>

              {/* API Key Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-white/70 flex items-center justify-between">
                  <span>Gemini API Key</span>
                  {isKeySaved && (
                    <span className="text-emerald-400 text-[10px] inline-flex items-center gap-1">
                      <Check className="h-3 w-3" /> Key active
                    </span>
                  )}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKeyText ? 'text' : 'password'}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={geminiKeys.length > 0 ? '••••••••••••••••••••••••••••' : 'AIzaSy...'}
                      className="w-full min-h-[44px] rounded-xl bg-white/5 border border-white/10 px-3.5 pr-10 text-xs font-mono text-white placeholder-white/30 outline-none focus:border-indigo-400 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeyText(!showKeyText)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-1"
                    >
                      {showKeyText ? (
                        <EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                      ) : (
                        <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveKey}
                    disabled={!apiKeyInput.trim()}
                    className="min-h-[44px] px-4 rounded-xl bg-white/15 hover:bg-white/25 active:scale-[0.96] text-white text-xs font-medium border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Model Presets */}
              <div className="space-y-2 pt-1">
                <label className="text-[11px] font-medium text-white/70">
                  Select Default Model Preset
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {GEMINI_MODEL_PRESETS.map((m) => {
                    const isSelected = chosenModel === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSelectPreset(m.id)}
                        className={`p-3 rounded-2xl text-left border transition-all active:scale-[0.96] ${
                          isSelected
                            ? 'bg-indigo-600/20 border-indigo-500/50 shadow-sm'
                            : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/15'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.2 rounded-full ${
                            isSelected ? 'bg-indigo-400/20 text-indigo-300' : 'bg-white/5 text-white/50'
                          }`}>
                            {m.badge}
                          </span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-indigo-400" />}
                        </div>
                        <h4 className="text-xs font-semibold text-white mt-1">{m.name}</h4>
                        <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2 leading-relaxed">
                          {m.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="min-h-[44px] px-4 rounded-full bg-white/5 hover:bg-white/10 text-white/70 text-xs font-medium active:scale-[0.96] transition-all"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="min-h-[44px] px-5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium inline-flex items-center gap-2 active:scale-[0.96] transition-all shadow-lg shadow-indigo-500/20"
                >
                  <span>Continue</span>
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Ready & Sample Canvas */}
          {step === 3 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="mt-5 space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">
                  You&apos;re All Set
                </h2>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">
                  Start experimenting right away or explore with an interactive pre-loaded starter canvas.
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleFinish(true)}
                  className="w-full p-4 rounded-2xl bg-indigo-600/15 border border-indigo-500/30 hover:bg-indigo-600/25 active:scale-[0.96] transition-all text-left flex items-start gap-3.5 group"
                >
                  <div className="h-10 w-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 shrink-0 group-hover:scale-105 transition-transform">
                    <Compass className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">Explore Interactive Sample Canvas</h4>
                    <p className="text-[11px] text-white/60 mt-0.5 leading-relaxed">
                      Loads a starter spatial workspace with a functional live calculator app and interactive feature cards.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleFinish(false)}
                  className="w-full p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] active:scale-[0.96] transition-all text-left flex items-start gap-3.5"
                >
                  <div className="h-10 w-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-white/70 shrink-0">
                    <Layers className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">Start with Clean Canvas</h4>
                    <p className="text-[11px] text-white/60 mt-0.5 leading-relaxed">
                      Opens an empty infinite canvas. Press <strong>⌘K</strong> anytime to summon Vision Intelligence.
                    </p>
                  </div>
                </button>
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="min-h-[44px] px-4 rounded-full bg-white/5 hover:bg-white/10 text-white/70 text-xs font-medium active:scale-[0.96] transition-all"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => handleFinish(false)}
                  className="min-h-[44px] px-5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium active:scale-[0.96] transition-all shadow-lg shadow-indigo-500/20"
                >
                  Enter visionOS
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
