'use client';

import { useWorkspaceActive } from './WorkspaceActivity';

import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import { normalizeArtifactNetworkOrigin } from '../lib/artifactNetworkPolicy';

export function ArtifactNetworkPermissionsDialog({
  requestedOrigins,
  allowedOrigins,
  peerConnectionsAllowed,
  peerRequested = false,
  appPaused = false,
  rememberAvailable,
  busy = false,
  error,
  allowAnywayLabel,
  onClose,
  onAllow,
  onAllowAnyway,
  onRevoke,
  onRevokePeerConnections,
}: {
  requestedOrigins: readonly string[];
  allowedOrigins: readonly string[];
  peerConnectionsAllowed: boolean;
  peerRequested?: boolean;
  appPaused?: boolean;
  rememberAvailable: boolean;
  busy?: boolean;
  error?: string | null;
  allowAnywayLabel?: string | null;
  onClose: () => void;
  onAllow: (choice: {
    origins: string[];
    rememberOrigins: boolean;
    allowPeerConnections: boolean;
    rememberPeerConnections: boolean;
  }) => void;
  onAllowAnyway?: (choice: {
    origins: string[];
    rememberOrigins: boolean;
    allowPeerConnections: boolean;
    rememberPeerConnections: boolean;
  }) => void;
  onRevoke: (origin: string) => void;
  onRevokePeerConnections: () => void;
}) {
  const workspaceActive = useWorkspaceActive();
  const viewport = useVisibleViewport();
  const dialogRef = useDialogFocus<HTMLDivElement>(workspaceActive, onClose);
  const [selected, setSelected] = useState<string[]>([]);
  const [remember, setRemember] = useState(false);
  const [allowPeerConnections, setAllowPeerConnections] = useState(false);
  const [manualOrigin, setManualOrigin] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(peerRequested);
  const [manualError, setManualError] = useState<string | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const current = useMemo(() => new Set(allowedOrigins), [allowedOrigins]);
  const requests = useMemo(() => requestedOrigins.filter((origin) => !current.has(origin)), [requestedOrigins, current]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  React.useEffect(() => {
    if (peerRequested) setAdvancedOpen(true);
  }, [peerRequested]);

  if (typeof document === 'undefined') return null;

  const toggleSite = (origin: string) => {
    setSelected((existing) => existing.includes(origin)
      ? existing.filter((item) => item !== origin)
      : [...existing, origin]);
  };

  const addManualOrigin = () => {
    const origin = normalizeArtifactNetworkOrigin(manualOrigin);
    if (!origin) {
      setManualError('Enter one exact HTTPS origin, such as https://api.example.com.');
      manualInputRef.current?.focus();
      return;
    }
    if (current.has(origin)) {
      setManualError('This app already has access to that site.');
      return;
    }
    setManualError(null);
    setSelected((existing) => existing.includes(origin) ? existing : [...existing, origin]);
    setManualOrigin('');
  };

  if (!workspaceActive) return null;
  return createPortal(
    <div
      className="studio-focus-backdrop fixed z-[10040] flex items-center justify-center"
      style={{
        left: viewport.left,
        top: viewport.top,
        width: viewport.width,
        height: viewport.height,
        padding: 'max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-network-title"
        aria-describedby="artifact-network-description"
        tabIndex={-1}
        className="studio-canvas-chrome studio-safety-surface flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border outline-none"
      >
        <header className="flex min-h-[56px] shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4">
          <h2 id="artifact-network-title" className="text-sm font-semibold text-white">Website access</h2>
          <button
            type="button"
            data-dialog-initial-focus
            onClick={onClose}
            disabled={busy}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-200 hover:bg-white/10 disabled:opacity-50"
            aria-label="Close website access"
            title="Close website access"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div id="artifact-network-description" className="space-y-2 text-sm leading-relaxed text-slate-300">
            <p>Allowed sites can provide scripts and other resources. Their scripts can read this app&apos;s saved data and send it to that site.</p>
            <p className="text-xs text-slate-400">Access is limited to each exact HTTPS site. Some sites may still refuse connections. Embedded sites and form submissions remain blocked.</p>
          </div>

          {requests.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Requested sites</legend>
              {requests.map((origin) => (
                <label key={origin} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-sm text-slate-100">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(origin)}
                    disabled={busy}
                    onChange={() => toggleSite(origin)}
                    className="h-4 w-4 accent-indigo-400"
                  />
                  <span className="min-w-0 break-all font-mono text-xs">{origin}</span>
                </label>
              ))}
            </fieldset>
          )}

          {selected.filter((origin) => !requests.includes(origin)).length > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Additional sites</legend>
              {selected.filter((origin) => !requests.includes(origin)).map((origin) => (
                <label key={origin} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-indigo-300/20 bg-indigo-300/[0.06] px-3 py-2 text-sm text-slate-100">
                  <input
                    type="checkbox"
                    checked
                    disabled={busy}
                    onChange={() => toggleSite(origin)}
                    className="h-4 w-4 accent-indigo-400"
                  />
                  <span className="min-w-0 flex-1 break-all font-mono text-xs">{origin}</span>
                </label>
              ))}
            </fieldset>
          )}

          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            className="rounded-xl border border-white/10 bg-white/[0.025]"
          >
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center px-3 text-sm font-medium text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/60">
              Advanced access
            </summary>
            <div className="space-y-4 border-t border-white/10 p-3">
          <div className="space-y-2">
            <label htmlFor="artifact-network-manual-origin" className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Add a site</label>
            <div className="flex items-stretch gap-2">
              <input
                ref={manualInputRef}
                id="artifact-network-manual-origin"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={manualOrigin}
                disabled={busy}
                onChange={(event) => {
                  setManualOrigin(event.target.value);
                  if (manualError) setManualError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addManualOrigin();
                  }
                }}
                placeholder="https://api.example.com"
                aria-invalid={Boolean(manualError)}
                aria-describedby={manualError ? 'artifact-network-manual-error' : undefined}
                className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.06] px-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-300/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={addManualOrigin}
                disabled={busy || !manualOrigin}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] text-slate-200 hover:bg-white/10 disabled:opacity-40"
                aria-label="Add HTTPS site"
                title="Add HTTPS site"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {manualError && <p id="artifact-network-manual-error" role="alert" className="text-xs text-rose-200">{manualError}</p>}
          </div>
          <section className="space-y-2" aria-labelledby="artifact-network-peer-title">
            <h3 id="artifact-network-peer-title" className="text-xs font-semibold uppercase tracking-wide text-slate-400">Peer-to-peer APIs</h3>
            {peerConnectionsAllowed ? (
              <p className="text-xs text-slate-300">Enabled for this code version. Remove it from Current access below.</p>
            ) : (
              <label className="flex min-h-[44px] items-start gap-3 rounded-xl border border-amber-200/15 bg-amber-200/[0.04] px-3 py-2.5 text-sm text-slate-100">
                <input
                  type="checkbox"
                  checked={allowPeerConnections}
                  disabled={busy}
                  onChange={(event) => {
                    setAllowPeerConnections(event.target.checked);
                  }}
                  className="mt-1 h-4 w-4 accent-amber-300"
                />
                <span className="min-w-0">
                  <span className="block font-medium">Enable peer-to-peer APIs</span>
                </span>
              </label>
            )}
            <p className="text-xs leading-relaxed text-amber-100/80">Blocking peer-to-peer APIs is best effort in browser previews. These APIs can communicate outside the website list and may expose your network address. Only enable them for apps you trust.</p>
          </section>
            </div>
          </details>

          {(allowedOrigins.length > 0 || peerConnectionsAllowed) && (
            <section className="space-y-2" aria-labelledby="artifact-network-current-title">
              <h3 id="artifact-network-current-title" className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current access</h3>
              {allowedOrigins.map((origin) => (
                <div key={origin} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] px-3 py-2">
                  <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-100">{origin}</span>
                  <button
                    type="button"
                    onClick={() => onRevoke(origin)}
                    disabled={busy}
                    className="min-h-[44px] shrink-0 rounded-lg px-3 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
                    aria-label={`Remove access to ${origin}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {peerConnectionsAllowed && (
                <div className="flex min-h-[44px] items-center gap-3 rounded-xl border border-amber-200/15 bg-amber-200/[0.04] px-3 py-2">
                  <span className="min-w-0 flex-1 text-xs text-slate-100">Peer-to-peer APIs</span>
                  <button
                    type="button"
                    onClick={onRevokePeerConnections}
                    disabled={busy}
                    className="min-h-[44px] shrink-0 rounded-lg px-3 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
                    aria-label="Remove peer-to-peer access"
                  >
                    Remove
                  </button>
                </div>
              )}
            </section>
          )}

          {rememberAvailable ? (
            <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={remember}
                disabled={busy}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-4 w-4 accent-indigo-400"
              />
              <span>Remember these choices for this code version</span>
            </label>
          ) : (
            <p className="rounded-xl border border-amber-200/15 bg-amber-200/[0.05] px-3 py-2 text-xs leading-relaxed text-amber-100/90">
              Access will last for this run because this browser cannot save permission choices.
            </p>
          )}

          <p className="text-xs leading-relaxed text-slate-400">{appPaused ? 'The app stays paused until you choose Run.' : 'Allowing access reloads the app. Unsaved entries in the app may be lost.'}</p>
          {error && <p role="alert" className="rounded-xl border border-rose-200/20 bg-rose-200/[0.06] px-3 py-2 text-sm text-rose-100">{error}</p>}
          {allowAnywayLabel && onAllowAnyway && (
            <div className="space-y-2 rounded-xl border border-amber-200/20 bg-amber-200/[0.05] p-3">
              <p className="text-xs leading-relaxed text-amber-100">App data could not be confirmed on this device. {appPaused ? 'The app will stay paused until you choose Run.' : 'Unsaved inputs may reset.'}</p>
              <button
                type="button"
                onClick={() => onAllowAnyway({
                  origins: [...selectedSet],
                  rememberOrigins: remember,
                  allowPeerConnections,
                  rememberPeerConnections: remember,
                })}
                disabled={busy}
                className="min-h-[44px] w-full rounded-xl border border-amber-200/25 bg-amber-200/10 px-3 text-sm font-semibold text-amber-100 hover:bg-amber-200/15 disabled:opacity-45"
              >
                {allowAnywayLabel}
              </button>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-white/10 p-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-slate-300 hover:bg-white/10 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAllow({
              origins: [...selectedSet],
              rememberOrigins: remember,
              allowPeerConnections,
              rememberPeerConnections: remember,
            })}
            disabled={busy || (selectedSet.size === 0 && !allowPeerConnections)}
            className="min-h-[44px] rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-950/30 hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? 'Saving…' : appPaused ? 'Allow access' : 'Allow and reload app'}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
