'use client';

import { AIOrb } from './AIOrb';


import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Plus,
  Settings2,
} from 'lucide-react';
import { readLocalStorage, writeLocalStorage } from '../lib/browserStorage';
import {
  readWorkspaceSummary,
  WORKSPACE_STUDIO_SUMMARY_KEY,
  type WorkspaceLaunchIntent,
  type WorkspaceSummary,
  type WorkspaceSummaryState,
} from '../lib/workspaceStudio';
import { DialogShell } from './DialogShell';
import { ProviderSetup } from './ProviderSetup';
import { VisionOnboardingModal } from './VisionOnboardingModal';
import { StudioPreview } from './StudioPreview';
import './studio.css';

export interface VisionDashboardProps {
  onOpenCanvas: (options?: {
    prompt?: string;
    template?: string;
    intent?: WorkspaceLaunchIntent;
  }) => void;
  onOpenTour: () => void;
}

type ExampleId = 'field-notes' | 'brief-slides' | 'connections';
type ExampleInfo = {
  id: ExampleId;
  title: string;
  caption: string;
  detail: string;
  bundle: string;
};

const EXAMPLES: ExampleInfo[] = [
  {
    id: 'field-notes',
    title: 'From sketch to app',
    caption: 'Turn a rough interface into something you can use.',
    detail: 'A small focus timer, with its sketch, short brief, and presentation arranged around it.',
    bundle: 'A local timer app, an editable sketch, a short brief, and a three-slide deck.',
  },
  {
    id: 'brief-slides',
    title: 'Give a brief its shape',
    caption: 'Keep the thinking beside the presentation.',
    detail: 'A two-part project brief placed beside three slides that carry the same idea forward.',
    bundle: 'An editable two-section brief and three editable slide cards on a new page.',
  },
  {
    id: 'connections',
    title: 'Think in connections',
    caption: 'Move ideas around until the relationships make sense.',
    detail: 'A handful of notes linked into a small decision diagram you can rearrange.',
    bundle: 'Editable notes and connectors on a new page. AI is not used when you add it.',
  },
];

function intentId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `studio-${crypto.randomUUID()}`;
  return `studio-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeIntent(kind: WorkspaceLaunchIntent['kind'], options: Partial<WorkspaceLaunchIntent> = {}): WorkspaceLaunchIntent {
  return { id: intentId(), kind, ...options };
}

function isSummaryStateWithData(state: WorkspaceSummaryState): state is Extract<WorkspaceSummaryState, { summary: WorkspaceSummary }> {
  return state.status === 'ready' || state.status === 'empty';
}

export default function VisionDashboard({ onOpenCanvas, onOpenTour }: VisionDashboardProps) {
  const [workspace, setWorkspace] = useState<WorkspaceSummaryState>({ status: 'checking' });
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [allPagesOpen, setAllPagesOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerNotice, setProviderNotice] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [selectedExample, setSelectedExample] = useState<ExampleInfo | null>(null);
  const [appearance, setAppearance] = useState<'system' | 'light' | 'dark'>('system');
  const [appearanceSaved, setAppearanceSaved] = useState(true);

  const summary = isSummaryStateWithData(workspace) ? workspace.summary : null;
  const selectedPage = useMemo(() => {
    if (!summary) return null;
    const pageId = selectedPageId ?? summary.activePageId;
    return summary.pages.find((page) => page.id === pageId) ?? summary.pages.find((page) => page.id === summary.activePageId) ?? null;
  }, [summary, selectedPageId]);
  const selectedOverview = selectedPage?.id === summary?.activePageId ? summary?.overview : null;

  useEffect(() => {
    try {
      setWorkspace(readWorkspaceSummary());
    } catch {
      setWorkspace({ status: 'error' });
    }
    const savedAppearance = readLocalStorage('visionos_appearance');
    if (savedAppearance.available && (savedAppearance.value === 'light' || savedAppearance.value === 'dark' || savedAppearance.value === 'system')) {
      setAppearance(savedAppearance.value);
      applyAppearance(savedAppearance.value);
    } else {
      const current = document.documentElement.dataset.appearance;
      const fallback = current === 'light' || current === 'dark' ? current : 'system';
      setAppearance(fallback);
      applyAppearance(fallback);
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_STUDIO_SUMMARY_KEY && event.key !== null) return;
      try {
        setWorkspace(readWorkspaceSummary());
      } catch {
        setWorkspace({ status: 'error' });
      }
    };
    const handleLocalSummary = () => setWorkspace(readWorkspaceSummary());
    window.addEventListener('storage', handleStorage);
    window.addEventListener('visionos:studio-summary', handleLocalSummary);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('visionos:studio-summary', handleLocalSummary);
    };
  }, []);

  function applyAppearance(next: 'system' | 'light' | 'dark') {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.appearance = next;
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('visionos:appearance-change'));
    }
  }

  function chooseAppearance(next: 'system' | 'light' | 'dark') {
    setAppearance(next);
    applyAppearance(next);
    setAppearanceSaved(writeLocalStorage('visionos_appearance', next));
  }

  function refreshSummary() {
    try {
      setWorkspace(readWorkspaceSummary());
    } catch {
      setWorkspace({ status: 'error' });
    }
  }

  function openCanvas(kind: WorkspaceLaunchIntent['kind'] = 'open', options: Partial<WorkspaceLaunchIntent> = {}) {
    onOpenCanvas({ intent: makeIntent(kind, options) });
  }

  function openExample(example: ExampleId) {
    openCanvas('example', { example });
    setSelectedExample(null);
  }

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanPrompt = prompt.trim();
    if (cleanPrompt) {
      onOpenCanvas({ prompt: cleanPrompt, intent: makeIntent('draft', { draft: cleanPrompt }) });
    } else {
      openCanvas('open');
    }
  }

  const isReturning = workspace.status === 'ready';
  const isEmpty = workspace.status === 'empty';
  const headline = isReturning ? 'Pick up where you left off.' : isEmpty ? 'Start with a blank canvas.' : 'Welcome to your studio.';
  const subhead = isReturning
    ? 'Continue your current page or start a new one.'
    : isEmpty
      ? 'Sketch, write, and build together on one canvas.'
      : 'Open your canvas, start a draft, or explore the sample.';

  function statusContent() {
    switch (workspace.status) {
      case 'checking': return <>Checking this device…</>;
      case 'unavailable': return <>Workspace overview unavailable</>;
      case 'error': return <>We couldn’t read the workspace overview.</>;
      case 'empty': return <>No canvas content yet</>;
      case 'ready': return <>On this device</>;
    }
  }

  return (
    <main className="studio" aria-label="visionOS Studio" data-studio-scroll>
      <div className="studio__inner">
        <header className="studio-header">
          <div className="studio-header__brand" aria-label="visionOS Studio">
            <span className="studio-header__wordmark">visionOS</span>
            <span className="studio-header__separator" aria-hidden="true">/</span>
            <span className="studio-header__location">Studio</span>
          </div>
          <nav className="studio-header__nav" aria-label="Studio tools">
            <button className="studio-nav-button" type="button" onClick={() => setProviderOpen(true)}>
              <AIOrb size={17} strokeWidth={1.7} />
              <span>AI setup</span>
            </button>
            <button className="studio-nav-button" type="button" onClick={() => setHelpOpen(true)}>
              <CircleHelp size={17} strokeWidth={1.7} />
              <span>Help</span>
            </button>
            <button className="studio-nav-button" type="button" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={17} strokeWidth={1.7} />
              <span>Settings</span>
            </button>
          </nav>
        </header>

        <section className="studio-intro" aria-labelledby="studio-headline">
          <span className="studio-eyebrow studio-intro__eyebrow">{isReturning ? 'YOUR WORKSPACE' : isEmpty ? 'A FRESH CANVAS' : 'LOCAL STUDIO'}</span>
          {providerNotice && <p className="studio-notice" role="status">{providerNotice}</p>}
          <h1 id="studio-headline">{headline}</h1>
          <p>{subhead}</p>
        </section>

        <section className={`studio-workspace${isReturning ? ' studio-workspace--returning' : ''}`} aria-label="Your workspace">
          <div className="studio-workspace__visual">
            {isReturning ? (
              <button
                className="studio-preview-open"
                type="button"
                aria-label={`Open canvas page: ${selectedPage?.name ?? 'Untitled page'}`}
                onClick={() => openCanvas('open', { pageId: selectedPage?.id ?? summary?.activePageId })}
              >
                <StudioPreview
                  mode={selectedOverview ? 'workspace' : 'neutral'}
                  label={selectedOverview ? 'Page overview' : selectedPage?.hasShapes === false ? 'Empty page' : 'Preview unavailable'}
                  overview={selectedOverview}
                  message={selectedPage?.hasShapes === false ? 'Add a note or sketch to this page.' : selectedPage?.id === summary?.activePageId ? 'Your page overview is unavailable.' : 'Open this page to see its overview.'}
                />
                <span className="studio-preview-open__hint"><span>Open page</span><ArrowRight size={16} /></span>
              </button>
            ) : isEmpty ? (
              <StudioPreview mode="field-notes" label="Field Notes · sample" />
            ) : (
              <StudioPreview mode="field-notes" label="Field Notes · sample" />
            )}
          </div>

          <div className="studio-workspace__details">
            <div className="studio-workspace__page-heading">
              <span className="studio-eyebrow">{isReturning ? 'CONTINUE' : isEmpty ? 'START HERE' : 'YOUR CANVAS'}</span>
              <h2>{isReturning ? selectedPage?.name ?? 'Your canvas' : isEmpty ? 'Blank canvas' : 'Open your canvas'}</h2>
              <p className="studio-workspace__device">{statusContent()}</p>
              {isReturning && selectedOverview && summary ? (
                <p className="studio-workspace__captured">Overview captured {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(summary.capturedAt))}</p>
              ) : null}
            </div>

            <div className="studio-workspace__summary">
              {isReturning ? (
                <p>Open this page to keep working.</p>
              ) : isEmpty ? (
                <p>Open a blank canvas, or add the labeled Field Notes sample to a new page.</p>
              ) : (
                <p>{workspace.status === 'error' ? 'The overview is unavailable. You can still open the canvas.' : 'Open your workspace, or try the labeled sample.'}</p>
              )}
            </div>

            {isReturning ? (
              <div className="studio-workspace__actions">
                <button className="studio-button studio-button--primary studio-button--wide" data-studio-continue type="button" onClick={() => openCanvas('open', { pageId: selectedPage?.id ?? summary?.activePageId })}>
                  <span>Continue canvas</span><ArrowRight size={17} />
                </button>
                <div className="studio-workspace__secondary-actions">
                  <button className="studio-text-action" type="button" onClick={() => openCanvas('new-page')}>
                    <Plus size={17} /> New page
                  </button>
                  {(summary?.pages.length ?? 0) > 1 ? (
                    <button className={`studio-text-action${allPagesOpen ? ' is-open' : ''}`} type="button" aria-expanded={allPagesOpen} onClick={() => setAllPagesOpen((open) => !open)}>
                      All pages <ChevronDown size={15} />
                    </button>
                  ) : null}
                </div>
                {allPagesOpen && summary ? (
                  <div className="studio-page-list" aria-label="All pages">
                    {summary.pages.map((page) => (
                      <button
                        key={page.id}
                        className={`studio-page-list__item${page.id === selectedPage?.id ? ' is-current' : ''}`}
                        type="button"
                        onClick={() => { setSelectedPageId(page.id); setAllPagesOpen(false); openCanvas('open', { pageId: page.id }); }}
                      >
                        <span>{page.name}</span>
                        {page.id === selectedPage?.id ? <Check size={16} aria-label="Current page" /> : <ChevronRight size={16} />}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : isEmpty ? (
              <div className="studio-workspace__actions">
                <button className="studio-button studio-button--primary studio-button--wide" data-studio-continue type="button" onClick={() => openCanvas('open')}>
                  <span>Open canvas</span><ArrowRight size={17} />
                </button>
                <button className="studio-button studio-button--secondary studio-button--wide" type="button" onClick={() => openExample('field-notes')}>
                  Try the sample
                </button>
                <button className="studio-text-action studio-workspace__restore" type="button" onClick={() => openCanvas('restore')}>
                  <ArrowDownToLine size={16} /> Restore a backup
                </button>
              </div>
            ) : (
              <div className="studio-workspace__actions">
                <button className="studio-button studio-button--primary studio-button--wide" data-studio-continue type="button" onClick={() => openCanvas('open')}>
                  <span>Open canvas</span><ArrowRight size={17} />
                </button>
                {workspace.status === 'error' ? (
                  <button className="studio-button studio-button--secondary studio-button--wide" type="button" onClick={refreshSummary}>Try again</button>
                ) : null}
                <button className="studio-text-action studio-workspace__restore" type="button" onClick={() => openCanvas('restore')}>
                  <ArrowDownToLine size={16} /> Restore a backup
                </button>
                <button className="studio-button studio-button--secondary studio-button--wide" type="button" onClick={() => openExample('field-notes')}>
                  <span>Try the Field Notes sample</span><ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        </section>

        <form className="studio-composer" onSubmit={submitDraft}>
          <div className="studio-composer__intro">
            <span className="studio-composer__mark" aria-hidden="true"><Plus size={18} strokeWidth={1.8} /></span>
            <div>
              <span className="studio-eyebrow">CREATE</span>
              <label htmlFor="studio-prompt">Start with an idea</label>
              <p>Open a draft on your canvas. Nothing is sent automatically.</p>
            </div>
          </div>
          <div className="studio-composer__field">
            <textarea
              id="studio-prompt"
              rows={1}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe what you want to make…"
              aria-describedby="studio-composer-hint"
            />
            <button className="studio-button studio-button--quiet" type="submit">
              <span>{prompt.trim() ? 'Open in canvas' : 'Open canvas'}</span><ArrowRight size={17} />
            </button>
          </div>
          <span id="studio-composer-hint" className="studio-visually-hidden">Your description opens as a draft in the canvas. It is not sent automatically.</span>
        </form>

        <section className="studio-examples" aria-labelledby="studio-examples-heading">
          <div className="studio-examples__heading">
            <div>
              <span className="studio-eyebrow">EXPLORE</span>
              <h2 id="studio-examples-heading">Start from a working example</h2>
              <p>Choose a small, editable starting point and see exactly what it adds.</p>
            </div>
          </div>
          <div className="studio-example-grid">
            {EXAMPLES.map((example) => (
              <article className="studio-example" key={example.id}>
                <button className="studio-example__preview-button" type="button" onClick={() => setSelectedExample(example)} aria-label={`See details for ${example.title}`}>
                  <ExampleArtwork id={example.id} />
                </button>
                <div className="studio-example__copy">
                  <h3>{example.title}</h3>
                  <p>{example.caption}</p>
                  <button className="studio-example__detail-link" type="button" onClick={() => setSelectedExample(example)}>
                    See what’s inside <ChevronRight size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer className="studio-footer">
          <span>Studio</span>
          <button type="button" onClick={() => setDataOpen(true)}>Data &amp; backups</button>
          <button type="button" onClick={() => setHelpOpen(true)}>About this preview</button>
        </footer>
      </div>

      <ProviderSetup isOpen={providerOpen} onClose={() => setProviderOpen(false)} onSaved={(detail) => {
        const storage = detail.persistenceStatus === 'persistent' ? 'in this browser' : detail.persistenceStatus === 'session' ? 'for this tab session' : 'while this page stays open';
        setProviderNotice(`Key saved ${storage}. It has not been checked. AI sends only when you press Send.`);
      }} />

      <DialogShell
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Help"
      >
        <div className="studio-dialog-copy">
          <section>
            <h3>Welcome &amp; AI Onboarding</h3>
            <p>Tour spatial canvas controls and optionally configure an AI provider with an API key.</p>
            <button className="studio-dialog-link" type="button" onClick={() => { setHelpOpen(false); setOnboardingOpen(true); }}>
              Open onboarding guide <ArrowRight size={16} />
            </button>
          </section>
          <section>
            <h3>Try the sample</h3>
            <p>Add a local example to a new page. It won’t send an AI request.</p>
            <button className="studio-dialog-link" type="button" onClick={() => { setHelpOpen(false); onOpenTour(); }}>Try Field Notes with tips <ArrowRight size={16} /></button>
          </section>
          <section>
            <h3>Canvas controls</h3>
            <p>Draw, add notes, and arrange cards directly. Use the canvas toolbar for tools, pages, and view controls.</p>
          </section>
          <section>
            <h3>About this preview</h3>
            <p>visionOS is a local-first spatial workspace. Your canvas and its related work stay together on this device.</p>
          </section>
        </div>
      </DialogShell>

      <VisionOnboardingModal
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onGoToDashboard={() => setOnboardingOpen(false)}
      />

      <DialogShell
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
      >
        <div className="studio-settings">
          <section className="studio-settings__section">
            <div className="studio-settings__heading">
              <div><h3>AI providers</h3><p>Use your own provider key. AI is optional.</p></div>
              <button className="studio-button studio-button--secondary" type="button" onClick={() => { setSettingsOpen(false); setProviderOpen(true); }}>Set up AI</button>
            </div>
          </section>
          <section className="studio-settings__section">
            <h3>Appearance</h3>
            <p>Choose how Studio and the canvas appear on this device.</p>
            <fieldset className="studio-appearance" aria-label="Appearance">
              {(['system', 'light', 'dark'] as const).map((value) => (
                <label className={appearance === value ? 'is-selected' : ''} key={value}>
                  <input type="radio" name="studio-appearance" value={value} checked={appearance === value} onChange={() => chooseAppearance(value)} />
                  <span>{value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}</span>
                </label>
              ))}
            </fieldset>
            {!appearanceSaved ? <p className="studio-inline-status" role="status">Appearance changed for this visit. Browser storage is unavailable.</p> : null}
          </section>
          <section className="studio-settings__section">
            <div className="studio-settings__heading">
              <div><h3>Data &amp; backups</h3><p>Manage canvas data on this device. Download a backup to keep a separate copy.</p></div>
              <button className="studio-button studio-button--secondary" type="button" onClick={() => { setSettingsOpen(false); setDataOpen(true); }}>Open</button>
            </div>
          </section>
          <section className="studio-settings__section studio-settings__section--last">
            <h3>About</h3>
            <p>Studio is the entrance to your local canvas and the pages around it.</p>
          </section>
        </div>
      </DialogShell>

      <DialogShell
        isOpen={dataOpen}
        onClose={() => setDataOpen(false)}
        title="Data & backups"
        footer={<button className="studio-button studio-button--secondary" type="button" onClick={() => setDataOpen(false)}>Done</button>}
      >
        <div className="studio-dialog-copy">
          <p>Your workspace stays in this browser. Restore shows the backup contents and asks you to review the change before applying it.</p>
          <button className="studio-button studio-button--primary" type="button" onClick={() => { setDataOpen(false); openCanvas('restore'); }}>
            <ArrowDownToLine size={17} /> Restore a backup
          </button>
        </div>
      </DialogShell>

      <DialogShell
        isOpen={Boolean(selectedExample)}
        onClose={() => setSelectedExample(null)}
        title={selectedExample?.title ?? 'Example details'}
        footer={selectedExample ? (
          <div className="studio-example-dialog__actions">
            {selectedExample.id === 'field-notes' ? (
              <button className="studio-button studio-button--secondary" type="button" onClick={() => { setSelectedExample(null); openCanvas('new-page'); }}>Make your own</button>
            ) : null}
            <button className="studio-button studio-button--primary" type="button" onClick={() => openExample(selectedExample.id)}>Try this example <ArrowRight size={16} /></button>
          </div>
        ) : undefined}
      >
        {selectedExample ? (
          <div className="studio-example-dialog">
            <ExampleArtwork id={selectedExample.id} large />
            <p>{selectedExample.detail}</p>
            <div className="studio-example-dialog__included">
              <span className="studio-eyebrow">INCLUDED</span>
              <p>{selectedExample.bundle}</p>
            </div>
            <p className="studio-example-dialog__note">This adds a new page. You decide if and when to ask AI for help.</p>
          </div>
        ) : null}
      </DialogShell>
    </main>
  );
}

function ExampleArtwork({ id, large = false }: { id: ExampleId; large?: boolean }) {
  return (
    <div className={`studio-example-artwork studio-example-artwork--${id}${large ? ' is-large' : ''}`} aria-hidden="true">
      {id === 'field-notes' ? (
        <div className="studio-example-artwork__field-notes">
          <div className="studio-example-artwork__sketch"><strong>25:00</strong><span /></div>
          <div className="studio-example-artwork__timer"><small>FIELD NOTES</small><strong>25:00</strong><span>Start</span></div>
          <div className="studio-example-artwork__brief"><strong>Room to focus.</strong><i /><i /><i /></div>
          <span className="studio-example-artwork__line" />
        </div>
      ) : id === 'brief-slides' ? (
        <div className="studio-example-artwork__brief-slides">
          <div className="studio-example-artwork__document"><strong>The brief</strong><i /><i /><i /><i /><i /></div>
          <div className="studio-example-artwork__slide"><small>FIELD NOTES / 01</small><strong>Room<br />to focus.</strong></div>
          <div className="studio-example-artwork__slide-edge" />
        </div>
      ) : (
        <div className="studio-example-artwork__connections">
          <span className="studio-example-artwork__link studio-example-artwork__link--a" />
          <span className="studio-example-artwork__link studio-example-artwork__link--b" />
          <div className="studio-example-artwork__idea">An idea</div>
          <div className="studio-example-artwork__choice studio-example-artwork__choice--a">Try this</div>
          <div className="studio-example-artwork__choice studio-example-artwork__choice--b">Or this</div>
        </div>
      )}
    </div>
  );
}
