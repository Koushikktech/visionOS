'use client';

import { useWorkspaceActive } from './WorkspaceActivity';

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor, TLEditorSnapshot } from '@tldraw/tldraw';
import { Download, ShieldCheck, TriangleAlert } from 'lucide-react';
import { createWorkspaceBackup } from '../lib/workspaceBackup';
import { formatRecoverySavedAt, summarizeCanvasRecovery, type CanvasRecoverySummary } from '../lib/canvasRecoverySummary';
import { getCanvasRecoveryDialogLayout } from '../lib/canvasRecoveryViewport';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import './canvas-chrome.css';

export type BoardRecoveryStatus =
  | 'checking'
  | 'saving'
  | 'recoveryCopySaved'
  | 'error'
  | 'conflict'
  | 'unavailable';

export interface BoardRecoveryViewState {
  status: BoardRecoveryStatus;
  savedAt?: string;
  reviewRevision?: number;
  liveRevision?: number;
  hasUncommittedChanges?: boolean;
  error?: string;
  recoverySnapshot?: TLEditorSnapshot | null;
}

export interface BoardRecoveryNoticeProps {
  editor: Editor | null;
  state: BoardRecoveryViewState;
  menuOpen: boolean;
  menuTarget: HTMLElement | null;
  onKeepCurrent(expectedRevision: number, expectedLiveRevision: number, expectedLiveSnapshot: TLEditorSnapshot): Promise<void>;
  onRestoreRecovery(expectedRevision: number, expectedLiveRevision: number, expectedLiveSnapshot: TLEditorSnapshot): Promise<void>;
}

interface ReviewedRecoveryCopy {
  snapshot: TLEditorSnapshot;
  summary: CanvasRecoverySummary;
  reviewRevision: number;
  liveRevision: number;
  liveSnapshot: TLEditorSnapshot;
  savedAt?: string;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatTypes(typeCounts: Array<{ label: string; count: number }>) {
  return typeCounts.length
    ? typeCounts.map(({ label, count }) => `${count} × ${label}`).join(', ')
    : 'No canvas items';
}

function RecoverySummaryBlock({
  label,
  timeLabel,
  summary,
}: {
  label: string;
  timeLabel: string;
  summary: CanvasRecoverySummary;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <h3 className="text-xs font-semibold text-white">{label}</h3>
      <p className="mt-1 text-[11px] leading-4 text-white/55">{timeLabel}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-white/55">Pages</dt>
        <dd className="text-right font-medium text-white">{summary.pageCount}</dd>
        <dt className="text-white/55">Canvas items</dt>
        <dd className="text-right font-medium text-white">{summary.shapeCount}</dd>
        <dt className="col-span-2 text-white/55">Types</dt>
        <dd className="col-span-2 break-words font-medium text-white">{formatTypes(summary.typeCounts)}</dd>
        <dt className="col-span-2 text-white/55">Title sample</dt>
        <dd className="col-span-2 break-words font-medium text-white">
          {summary.titleSamples.length ? summary.titleSamples.join(' · ') : 'No titled pages or items'}
        </dd>
      </dl>
    </section>
  );
}

export function BoardRecoveryNotice({
  editor,
  state,
  menuOpen,
  menuTarget,
  onKeepCurrent,
  onRestoreRecovery,
}: BoardRecoveryNoticeProps) {
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('');
  const [reviewRefreshRequired, setReviewRefreshRequired] = useState(false);
  const [reviewRevisionRefreshRequired, setReviewRevisionRefreshRequired] = useState(false);
  const [reviewLiveRevisionRefreshRequired, setReviewLiveRevisionRefreshRequired] = useState(false);
  const [reviewedRecovery, setReviewedRecovery] = useState<ReviewedRecoveryCopy | null>(null);
  const [openCanvasSummary, setOpenCanvasSummary] = useState<CanvasRecoverySummary | null>(null);
  const workspaceActive = useWorkspaceActive();
  const viewport = useVisibleViewport();
  const dialogRef = useDialogFocus<HTMLDivElement>(workspaceActive && isReviewOpen, () => setIsReviewOpen(false));

  const captureReviewedCopy = useCallback(() => {
    if (
      !editor ||
      state.status !== 'conflict' ||
      !state.recoverySnapshot ||
      state.reviewRevision === undefined ||
      state.liveRevision === undefined
    ) return;
    const liveSnapshot = editor.getSnapshot();
    setReviewedRecovery({
      snapshot: state.recoverySnapshot,
      summary: summarizeCanvasRecovery(state.recoverySnapshot),
      reviewRevision: state.reviewRevision,
      liveRevision: state.liveRevision,
      liveSnapshot,
      savedAt: state.savedAt,
    });
    setOpenCanvasSummary(summarizeCanvasRecovery(liveSnapshot));
    setActionError('');
    setDownloadStatus('');
    setReviewRefreshRequired(false);
    setReviewRevisionRefreshRequired(false);
    setReviewLiveRevisionRefreshRequired(false);
    setIsReviewOpen(true);
    if (isReviewOpen) {
      window.requestAnimationFrame(() =>
        dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus()
      );
    }
  }, [dialogRef, editor, isReviewOpen, state]);

  const closeReview = useCallback(() => {
    if (isActing) return;
    setIsReviewOpen(false);
    setActionError('');
  }, [isActing]);

  const downloadCopy = useCallback(async (snapshot: TLEditorSnapshot, filename: string) => {
    if (!editor) {
      setDownloadStatus('Open the canvas before downloading a workspace backup.');
      return;
    }
    setDownloadStatus('Preparing a downloadable workspace backup…');
    try {
      const { blob, portability } = await createWorkspaceBackup(snapshot, {
        resolveAssetUrl: (assetId) =>
          editor.resolveAssetUrl(assetId as Parameters<Editor['resolveAssetUrl']>[0], {
            screenScale: 1,
            shouldResolveToOriginal: true,
          }),
      });
      downloadBlob(blob, filename);
      const excluded = portability.excludedAssets.length;
      setDownloadStatus(
        excluded
          ? `Backup downloaded. ${excluded} linked media item(s) could not be packaged; their records are included, but those files may need their original source.`
          : `Backup downloaded with ${portability.embeddedAssetCount} media item(s) packaged.`
      );
    } catch (error) {
      setDownloadStatus(error instanceof Error ? error.message : 'Could not create the workspace backup.');
    }
  }, [editor]);

  const runChoice = useCallback(async (
    action: (
      expectedRevision: number,
      expectedLiveRevision: number,
      expectedLiveSnapshot: TLEditorSnapshot
    ) => Promise<void>,
    successMessage: string
  ) => {
    if (!reviewedRecovery) return;
    setIsActing(true);
    setActionError('');
    try {
      await action(
        reviewedRecovery.reviewRevision,
        reviewedRecovery.liveRevision,
        reviewedRecovery.liveSnapshot
      );
      setIsReviewOpen(false);
      setDownloadStatus(successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not complete the recovery action.';
      setActionError(message);
      if (/recovery copy changed|changed in another tab|updated copy/i.test(message)) {
        setReviewRefreshRequired(true);
        setReviewRevisionRefreshRequired(true);
      } else if (/board changed|workspace changed/i.test(message)) {
        setReviewRefreshRequired(true);
        setReviewLiveRevisionRefreshRequired(true);
      }
    } finally {
      setIsActing(false);
    }
  }, [reviewedRecovery]);

  const isConflict = state.status === 'conflict';
  const isStorageProblem = state.status === 'error' || state.status === 'unavailable';
  const canDownload = Boolean(editor && (isConflict ? state.recoverySnapshot : true));
  const reviewCopiesNowMatch = Boolean(
    isReviewOpen &&
    reviewedRecovery &&
    state.status === 'recoveryCopySaved' &&
    state.reviewRevision === undefined &&
    state.recoverySnapshot == null &&
    state.hasUncommittedChanges === false
  );
  const reviewIsStale = Boolean(
    isReviewOpen &&
    reviewedRecovery &&
    !reviewCopiesNowMatch &&
    (
      reviewRefreshRequired ||
      state.status !== 'conflict' ||
      state.reviewRevision !== reviewedRecovery.reviewRevision ||
      state.liveRevision !== reviewedRecovery.liveRevision
    )
  );
  const canReviewLatest = Boolean(
    reviewIsStale &&
    state.status === 'conflict' &&
    state.reviewRevision !== undefined &&
    state.liveRevision !== undefined &&
    state.recoverySnapshot &&
    (!reviewRevisionRefreshRequired || state.reviewRevision !== reviewedRecovery?.reviewRevision) &&
    (!reviewLiveRevisionRefreshRequired || state.liveRevision !== reviewedRecovery?.liveRevision)
  );
  const reviewedRecoveryRevisionChanged = Boolean(
    reviewedRecovery &&
    (state.status !== 'conflict' || state.reviewRevision !== reviewedRecovery.reviewRevision)
  );
  const reviewedLiveRevisionChanged = Boolean(
    reviewedRecovery && state.liveRevision !== reviewedRecovery.liveRevision
  );
  const staleReviewMessage = reviewRevisionRefreshRequired || reviewedRecoveryRevisionChanged
    ? 'The recovery copy changed while you were choosing. No choice was applied. Review the latest copy before continuing.'
    : reviewRefreshRequired || reviewedLiveRevisionChanged
      ? 'The open canvas changed during this review. Choices are paused until you review the current canvas again.'
      : 'A different recovery copy appeared while this review was open. Choices are paused until you review the latest copy.';
  const viewportPadding = 12;
  const dialogLayout = getCanvasRecoveryDialogLayout(viewport, viewportPadding);

  let statusMessage = 'Recovery copy saved on this device';
  if (state.status === 'checking') statusMessage = 'Checking recovery copy…';
  else if (state.status === 'saving') statusMessage = 'Saving recovery copy…';
  else if (isConflict) statusMessage = 'This canvas and its recovery copy differ';
  else if (state.status === 'unavailable') statusMessage = 'Automatic recovery is unavailable';
  else if (state.status === 'error') statusMessage = 'Could not save a recovery copy';
  const needsReview = isConflict || isStorageProblem;
  const liveAnnouncement = isConflict
    ? 'Recovery needs review. The open canvas and its on-device recovery copy differ.'
    : isStorageProblem
      ? 'Automatic recovery could not save a copy. Download a workspace backup.'
      : '';
  const menuStatus = menuOpen && menuTarget && typeof document !== 'undefined'
    ? createPortal(
      <section
        aria-labelledby="canvas-recovery-menu-title"
        aria-live="polite"
        className={`studio-canvas-chrome studio-safety-surface my-1 rounded-xl border p-3 ${needsReview ? 'border-amber-200/30 bg-amber-200/[0.07]' : 'border-white/10 bg-white/[0.04]'}`}
      >
        <div className="flex items-start gap-2">
          {needsReview ? (
            <TriangleAlert aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-amber-200" />
          ) : (
            <ShieldCheck aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-emerald-200" />
          )}
          <div className="min-w-0">
            <h3 id="canvas-recovery-menu-title" className="text-xs font-semibold text-white">On-device recovery</h3>
            <p className="mt-1 break-words text-xs leading-4 text-white/75">
              {state.status === 'recoveryCopySaved' && state.savedAt
                ? `${statusMessage} · ${formatRecoverySavedAt(state.savedAt)}`
                : statusMessage}
            </p>
            {state.error && isStorageProblem && (
              <p className="mt-1 break-words text-[11px] leading-4 text-amber-100/85">{state.error}</p>
            )}
          </div>
        </div>
        {isConflict && (
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={captureReviewedCopy}
              className="min-h-[44px] rounded-lg bg-amber-100/15 px-3 text-xs font-semibold text-amber-50 outline-none hover:bg-amber-100/25 focus-visible:ring-2 focus-visible:ring-amber-100"
            >
              Review recovery
            </button>
            {canDownload && (
              <button
                type="button"
                onClick={() => void downloadCopy(state.recoverySnapshot!, 'visionos-recovery-copy.json')}
                className="min-h-[44px] rounded-lg px-3 text-xs font-medium text-white/80 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-indigo-200"
              >
                Download copy
              </button>
            )}
          </div>
        )}
        {isStorageProblem && canDownload && (
          <button
            type="button"
            onClick={() => void downloadCopy(editor!.getSnapshot(), 'visionos-workspace-backup.json')}
            className="mt-2 min-h-[44px] w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 text-left text-xs font-semibold text-white outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-indigo-200"
          >
            Download workspace backup
          </button>
        )}
        {downloadStatus && (
          <p role="status" aria-live="polite" className="mt-2 break-words text-[11px] leading-4 text-white/75">{downloadStatus}</p>
        )}
      </section>,
      menuTarget
    )
    : null;

  return (
    <>
      <span id="canvas-recovery-trigger-description" className="sr-only">
        {needsReview ? 'Recovery needs review.' : statusMessage}
      </span>
      <span role="status" aria-live="polite" className="sr-only">{liveAnnouncement}</span>

      {menuStatus}

      {workspaceActive && isReviewOpen && reviewedRecovery && openCanvasSummary && typeof document !== 'undefined' && createPortal(
        <div
          data-canvas-recovery-dialog="true"
          className="studio-focus-backdrop fixed z-[800] flex items-center justify-center overflow-y-auto"
          style={{
            top: viewport.top,
            left: viewport.left,
            width: viewport.width,
            height: viewport.height,
            boxSizing: 'border-box',
            paddingTop: dialogLayout.paddingTop,
            paddingRight: dialogLayout.paddingRight,
            paddingBottom: dialogLayout.paddingBottom,
            paddingLeft: dialogLayout.paddingLeft,
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeReview();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog" data-studio-safety="true"
            aria-modal="true"
            aria-labelledby="board-recovery-title"
            aria-describedby="board-recovery-description"
            tabIndex={-1}
            className="studio-canvas-chrome studio-safety-surface w-full overflow-y-auto rounded-2xl border p-4 sm:p-5"
            style={{
              width: dialogLayout.dialogWidth,
              maxWidth: 640,
              maxHeight: dialogLayout.dialogMaxHeight,
              boxSizing: 'border-box',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">On-device recovery copy</p>
                <h2 id="board-recovery-title" data-dialog-initial-focus tabIndex={-1} className="mt-1 text-lg font-semibold leading-snug outline-none">
                  Review recovery copy
                </h2>
              </div>
              <button
                type="button"
                onClick={closeReview}
                disabled={isActing}
                aria-label="Close recovery review"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-xl text-white/80 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <div id="board-recovery-description" className="mt-3 space-y-3 text-sm leading-5 text-white/80">
              <p>
                This review compares the current board snapshot with on-device recovery copy revision {reviewedRecovery.reviewRevision}. The source edit times are unavailable.
              </p>
              <RecoverySummaryBlock
                label="Currently open canvas"
                timeLabel="Edit time unavailable"
                summary={openCanvasSummary}
              />
              <RecoverySummaryBlock
                label="On-device recovery copy"
                timeLabel={reviewedRecovery.savedAt
                  ? `Committed on this device · ${formatRecoverySavedAt(reviewedRecovery.savedAt)}`
                  : 'Committed time unavailable'}
                summary={reviewedRecovery.summary}
              />
              <p>
                Restoring replaces the open canvas after a durable backup is saved. Keep current replaces and discards the recovery copy shown here. This on-device copy stores board records and media references; a downloaded workspace backup packages supported media files separately.
              </p>
            </div>

            {reviewIsStale && (
              <div role="alert" aria-live="polite" className="mt-3 rounded-lg border border-amber-200/30 bg-amber-200/[0.07] px-3 py-2 text-sm text-amber-50">
                {staleReviewMessage}
              </div>
            )}

            {reviewCopiesNowMatch && (
              <div role="status" aria-live="polite" className="mt-3 rounded-lg border border-emerald-200/25 bg-emerald-200/[0.07] px-3 py-2 text-sm text-emerald-50">
                The open canvas and recovery copy now match. No choice is needed. You can close this review or download the captured copy.
              </div>
            )}

            {(actionError || downloadStatus) && (
              <p role={actionError ? 'alert' : 'status'} aria-live={actionError ? 'assertive' : 'polite'} className="mt-3 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/90">
                {actionError || downloadStatus}
              </p>
            )}

            {state.error && <p className="mt-2 text-xs text-amber-100/90">{state.error}</p>}

            {reviewIsStale && canReviewLatest && (
              <button
                type="button"
                disabled={isActing}
                onClick={captureReviewedCopy}
                className="mt-3 min-h-[44px] w-full rounded-xl border border-amber-100/25 bg-amber-100/10 px-4 text-sm font-semibold text-amber-50 outline-none hover:bg-amber-100/15 focus-visible:ring-2 focus-visible:ring-amber-100 disabled:opacity-50"
              >
                Review latest copy
              </button>
            )}
            {((reviewIsStale && !canReviewLatest) || reviewCopiesNowMatch) && (
              <button
                type="button"
                disabled={isActing}
                onClick={closeReview}
                className="mt-3 min-h-[44px] w-full rounded-xl border border-white/20 bg-white/[0.06] px-4 text-sm font-semibold text-white outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:opacity-50"
              >
                Close review
              </button>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={isActing || reviewIsStale || reviewCopiesNowMatch}
                onClick={() => void runChoice(onKeepCurrent, 'Current canvas kept and recovery copy saved on this device.')}
                className="min-h-[44px] rounded-xl border border-white/20 bg-white/[0.06] px-4 text-sm font-semibold text-white outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-wait disabled:opacity-60"
              >
                {isActing ? 'Saving…' : 'Keep current and replace recovery copy'}
              </button>
              <button
                type="button"
                disabled={isActing || reviewIsStale || reviewCopiesNowMatch}
                onClick={() => void runChoice(onRestoreRecovery, 'Recovery copy restored.')}
                className="min-h-[44px] rounded-xl bg-indigo-300 px-4 text-sm font-semibold text-[#10121a] outline-none hover:bg-indigo-200 focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-60"
              >
                {isActing ? 'Working…' : 'Restore reviewed recovery copy'}
              </button>
              <button
                type="button"
                disabled={!editor || isActing}
                onClick={() => void downloadCopy(reviewedRecovery.snapshot, 'visionos-recovery-copy.json')}
                className="flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-medium text-white/85 outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:opacity-40"
              >
                <Download aria-hidden="true" size={15} />
                Download copy
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
