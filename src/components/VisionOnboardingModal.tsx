'use client';

import { AIOrb } from './AIOrb';


import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  Lock,
} from 'lucide-react';
import DialogShell from './DialogShell';
import ProviderSetup from './ProviderSetup';

/** Kept for existing Studio references; descriptions avoid claims about model capability. */
export const GEMINI_MODEL_PRESETS = [
  { id: 'gemini-3.8-flash', name: 'gemini-3.8-flash', tag: 'Default', description: 'Model identifier used for Gemini requests.', badge: 'Gemini' },
  { id: 'gemini-3.5-flash-lite', name: 'gemini-3.5-flash-lite', tag: 'Model', description: 'Model identifier used for Gemini requests.', badge: 'Gemini' },
  { id: 'gemini-4-argon', name: 'gemini-4-argon', tag: 'Model', description: 'Model identifier used for Gemini requests.', badge: 'Gemini' },
];

/** Kept for existing Studio references; saving a model ID does not verify access. */
export const OPENAI_MODEL_PRESETS = [
  { id: 'gpt-4o', name: 'gpt-4o', tag: 'Default', description: 'Model identifier used for OpenAI requests.', badge: 'OpenAI' },
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini', tag: 'Model', description: 'Model identifier used for OpenAI requests.', badge: 'OpenAI' },
  { id: 'o3-mini', name: 'o3-mini', tag: 'Model', description: 'Model identifier used for OpenAI requests.', badge: 'OpenAI' },
];

export interface VisionOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Legacy compatibility props; provider setup now owns key and model persistence. */
  geminiKeys?: string[];
  onSaveGeminiKey?: (key: string) => void;
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
  editor?: unknown;
  keyPersistenceStatus?: 'persistent' | 'session' | 'memory';
  openAiKeys?: string[];
  onSaveOpenAiKey?: (key: string) => void;
  onGoToDashboard?: () => void;
}

export function VisionOnboardingModal({ isOpen, onClose, onGoToDashboard }: VisionOnboardingModalProps) {
  const [step, setStep] = useState(0);
  const [isProviderSetupOpen, setProviderSetupOpen] = useState(false);

  const totalSteps = 3;

  return (
    <>
      <DialogShell
        isOpen={isOpen}
        onClose={onClose}
        title={
          step === 0
            ? 'Welcome to visionOS'
            : step === 1
            ? 'Connect an AI provider'
            : 'Fluid Gestures & Canvas'
        }
        description={
          step === 0
            ? 'A spatial, local-first studio for thinking, sketching, and building.'
            : step === 1
            ? 'Choose an AI provider and add your API key if you want AI features.'
            : 'Explore keyboard shortcuts and direct manipulation on the spatial canvas.'
        }
        className="studio-help-dialog"
        footer={
          <div className="flex items-center justify-between w-full gap-3">
            <div>
              {step > 0 ? (
                <button
                  type="button"
                  className="studio-provider-button flex items-center gap-1.5 min-h-[44px] min-w-[44px] active:scale-[0.96] transition-transform"
                  onClick={() => setStep((s) => s - 1)}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  className="studio-provider-button min-h-[44px] min-w-[44px] active:scale-[0.96] transition-transform"
                  onClick={onClose}
                >
                  Skip
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="studio-onboarding-step-count font-mono tabular-nums" aria-live="polite" aria-atomic="true">
                {step + 1} / {totalSteps}
              </span>
              <div className="flex gap-1.5" aria-hidden="true">
                {[0, 1, 2].map((idx) => (
                  <span
                    key={idx}
                    className={`studio-onboarding-progress-dot w-1.5 h-1.5 rounded-full transition-all ${step === idx ? 'w-4' : ''}`}
                    data-active={step === idx}
                  />
                ))}
              </div>
            </div>

            <div>
              {step < totalSteps - 1 ? (
                <button
                  type="button"
                  className="studio-provider-button studio-provider-button--primary flex items-center gap-1.5 min-h-[44px] min-w-[44px] active:scale-[0.96] transition-transform"
                  onClick={() => setStep((s) => s + 1)}
                >
                  Continue
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  className="studio-provider-button studio-provider-button--primary flex items-center gap-1.5 min-h-[44px] min-w-[44px] active:scale-[0.96] transition-transform"
                  onClick={() => {
                    onClose();
                    if (onGoToDashboard) onGoToDashboard();
                  }}
                >
                  Get Started
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        }
      >
        <div className="studio-provider-setup">
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="studio-onboarding-card p-4 flex items-start gap-3.5">
                <div className="studio-onboarding-card__icon w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <Layers size={20} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">A canvas for spatial thinking</h3>
                  <p className="text-sm leading-relaxed mt-1">
                    Keep tools close while you arrange sketches, notes, and working ideas across an open canvas.
                  </p>
                </div>
              </div>

              <div className="studio-onboarding-card p-4 flex items-start gap-3.5">
                <div className="studio-onboarding-card__icon w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <Lock size={20} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">You choose when to use AI</h3>
                  <p className="text-sm leading-relaxed mt-1">
                    AI requests are sent only after you submit a prompt. They include relevant canvas content and go to the provider you select.
                  </p>
                </div>
              </div>

              <div className="studio-onboarding-card p-4 flex items-start gap-3.5">
                <div className="studio-onboarding-card__icon w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <AIOrb size={20} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Turn sketches into app drafts</h3>
                  <p className="text-sm leading-relaxed mt-1">
                    Ask AI to turn a rough wireframe or sketch into an interactive app draft on the canvas.
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="studio-onboarding-card flex items-center justify-between p-3.5">
                <div>
                  <div className="text-xs font-semibold text-white/90">Configure an AI provider</div>
                  <div className="text-[11px] text-white/50 mt-0.5">Gemini, OpenRouter, and OpenAI API keys are supported.</div>
                </div>
                <button
                  type="button"
                  className="studio-provider-button text-xs py-1 px-3 min-h-[36px] active:scale-[0.96]"
                  onClick={() => setProviderSetupOpen(true)}
                >
                  Configure
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center font-mono text-xs">
                    ⌘K
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white/95">Spatial Omnibar</div>
                    <div className="text-[11px] text-white/50">Ask AI, run commands, or search shapes instantly.</div>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center font-mono text-xs">
                    Space
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white/95">Pan Canvas</div>
                    <div className="text-[11px] text-white/50">Hold Space and drag with your mouse or trackpad to pan.</div>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center font-mono text-xs">
                    V / H
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white/95">Select &amp; Hand Tools</div>
                    <div className="text-[11px] text-white/50">Switch quickly between selection box and pan navigation.</div>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center font-mono text-xs">
                    ⌘Z
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white/95">Unlimited Undo &amp; Redo</div>
                    <div className="text-[11px] text-white/50">Step backward and forward across your entire session safely.</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogShell>

      <ProviderSetup
        isOpen={isProviderSetupOpen}
        onClose={() => setProviderSetupOpen(false)}
      />
    </>
  );
}

export default VisionOnboardingModal;
