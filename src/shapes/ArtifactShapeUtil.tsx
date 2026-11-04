'use client';

import { AIOrb } from '../components/AIOrb';


import {
  BaseBoxShapeUtil,
  HTMLContainer,
  TLBaseShape,
  T,
  RecordProps,
  stopEventPropagation,
  TLResizeInfo,
} from '@tldraw/tldraw';
import { useWorkspaceActive } from '../components/WorkspaceActivity';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  RotateCcw,
  Code,
  Eye,
  Database,
  Trash2,
  Copy,
  Globe,
  Hand,
  Play,
  Save,
} from 'lucide-react';
import {
  validateStorageMessage,
  validateStorageSnapshot,
  storageRejectionMessage,
} from '../lib/artifactStorage';
import {
  createArtifactStorageSnapshotReconciler,
  sameArtifactStorage,
} from '../lib/artifactStorageHydration';
import { createArtifactStorageAcknowledgementTracker } from '../lib/artifactStorageAcknowledgement';
import {
  getArtifactSourceUpdate,
  buildArtifactSrcDoc,
} from '../lib/artifactRuntime';
import { ARTIFACT_BOUNDARY_SANDBOX, buildArtifactBoundarySrcDoc } from '../lib/artifactFrameBoundary';
import {
  activateDurableArtifactStorage,
  artifactSourceFingerprint,
  ARTIFACT_STORAGE_WORKSPACE_KEY,
  clearDurableArtifactStorage,
  deleteDurableArtifactStorage,
  getArtifactStorageEpochEventName,
  registerArtifactStorageWorkspaceFlusher,
  saveDurableArtifactStorage,
  undoDurableArtifactStorageClear,
} from '../lib/artifactStoragePersistence';
import { useShapeDraft } from '../hooks/useShapeDraft';
import { smartStopPropagation, isSpacePanHeld } from '../lib/panModifier';
import { subscribeToShapeEditing } from '../lib/shapeEditing';
import { ShapeFocusLayer } from '../components/ShapeFocusLayer';
import { ArtifactHeaderActions } from '../components/ArtifactHeaderActions';
import { ArtifactNetworkPermissionsDialog } from '../components/ArtifactNetworkPermissionsDialog';
import {
  ARTIFACT_NETWORK_LIMITS,
  isArtifactNavigationBlockedMessage,
  normalizeArtifactExternalLink,
  dedupeArtifactNetworkHints,
  validateArtifactExternalLinkMessage,
  validateArtifactNetworkHintMessage,
  type ArtifactNetworkHint,
} from '../lib/artifactNetworkPolicy';
import {
  clearArtifactNetworkGrantsForApp,
  clearArtifactNetworkSessionGrantsForApp,
  createArtifactNetworkGrantIdentity,
  forgetArtifactNetworkGrant,
  forgetArtifactNetworkSessionPeerConnections,
  forgetArtifactNetworkSessionSite,
  grantArtifactNetworkSessionPeerConnections,
  grantArtifactNetworkSessionSites,
  readArtifactNetworkGrants,
  readArtifactNetworkSessionPermissions,
  rememberArtifactNetworkChoices,
  setArtifactNetworkPeerConnections,
  subscribeArtifactNetworkPermissionInvalidations,
  subscribeToArtifactNetworkReview,
  type ArtifactNetworkGrantIdentity,
  type ArtifactNetworkPermissionInvalidation,
} from '../lib/artifactNetworkPermissions';
import {
  cancelPointerIntent,
  matchesPrimaryPointerIntent,
  startPrimaryPointerIntent,
  updatePointerIntent,
  type PrimaryPointerIntent,
} from '../lib/pointerIntent';

export type TLArtifactShape = TLBaseShape<
  'artifact',
  {
    w: number;
    h: number;
    title: string;
    code: string;
    color: string;
    storage?: Record<string, string>;
    networkEnabled?: boolean;
    runtimePaused?: boolean;
  }
>;

export const artifactShapeProps: RecordProps<TLArtifactShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  code: T.string,
  color: T.string,
  storage: T.optional(T.dict(T.string, T.string)),
  networkEnabled: T.optional(T.boolean),
  runtimePaused: T.optional(T.boolean),
};

import { stripMarkdownFences } from '../lib/sanitizeHtml';
export { stripMarkdownFences };

type ArtifactStorageSession = {
  epoch: number;
  generation: number;
  sourceFingerprint: string;
};

type ArtifactHydrationState = {
  shapeId: string;
  source: string;
  epoch: number | null;
  status: 'loading' | 'ready' | 'error';
  allowedUnconfirmedRun: boolean;
};

type NetworkPermissionHydration = {
  shapeId: string;
  source: string;
  epoch: number;
  status: 'loading' | 'ready';
  identity: ArtifactNetworkGrantIdentity | null;
  rememberedOrigins: string[];
  rememberedPeerConnections: boolean;
  canRemember: boolean;
};

type PendingNetworkStorageFlush = {
  requestId: string;
  frameToken: string;
  resolve: (storage: Record<string, string> | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

type NetworkStorageFlushResult = { received: boolean; accepted: boolean; durable: boolean };

const UNCONFIRMED_NETWORK_EPOCH = Number.MAX_SAFE_INTEGER;
const NETWORK_FLUSH_TIMEOUT_MS = 2_000;

function ArtifactComponent({
  shape,
  editor,
  onUpdate,
}: {
  shape: TLArtifactShape;
  editor?: import('@tldraw/tldraw').Editor;
  onUpdate: (updates: Partial<TLArtifactShape['props']>) => void;
}) {
  const workspaceActive = useWorkspaceActive();
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [isSelected, setIsSelected] = useState(false);
  const [key, setKey] = useState(0);
  const [canvasGestureMode, setCanvasGestureMode] = useState(false);
  const [storageStatus, setStorageStatus] = useState<{
    kind: 'saving' | 'saved' | 'error' | 'cleared';
    message: string;
  } | null>(null);
  const [workspaceEpoch, setWorkspaceEpoch] = useState<number | null>(null);
  const [hasClearUndo, setHasClearUndo] = useState(false);
  const [storageHydration, setStorageHydration] = useState<ArtifactHydrationState | null>(null);
  const [networkHydration, setNetworkHydration] = useState<NetworkPermissionHydration | null>(null);
  const [sessionSiteOrigins, setSessionSiteOrigins] = useState<string[]>([]);
  const [sessionPeerConnections, setSessionPeerConnections] = useState(false);
  const [networkHints, setNetworkHints] = useState<ArtifactNetworkHint[]>([]);
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [networkPermissionBusy, setNetworkPermissionBusy] = useState(false);
  const [networkPermissionError, setNetworkPermissionError] = useState<string | null>(null);
  const [showNetworkAllowAnyway, setShowNetworkAllowAnyway] = useState(false);
  const [peerConnectionRequested, setPeerConnectionRequested] = useState(false);
  const [localRuntimePaused, setLocalRuntimePaused] = useState(false);
  const [pendingExternalLink, setPendingExternalLink] = useState<{ url: string; origin: string } | null>(null);
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const [externalLinkError, setExternalLinkError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pointerActionHandledRef = useRef(false);
  const pointerIntentRef = useRef<PrimaryPointerIntent | null>(null);
  const pendingNetworkFlushRef = useRef<PendingNetworkStorageFlush | null>(null);
  const sourceGrantClearRef = useRef<Promise<unknown>>(Promise.resolve());
  const previousNetworkContextRef = useRef({ shapeId: shape.id, code: shape.props.code || '', epoch: workspaceEpoch });
  const networkChoiceWithoutStorageRef = useRef<{
    source: string;
    epoch: number;
    flush: NetworkStorageFlushResult;
  } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const checkSelected = () => {
      try {
        setIsSelected(editor.getSelectedShapeIds().includes(shape.id));
      } catch {}
    };
    checkSelected();
    return editor.store.listen(checkSelected);
  }, [editor, shape.id]);

  const { w, h, title, code, storage } = shape.props;
  const storageHydrationMatches = storageHydration?.shapeId === shape.id &&
    storageHydration.source === (code || '') &&
    storageHydration.epoch === workspaceEpoch;
  const storageHydrationReady = storageHydrationMatches && storageHydration?.status === 'ready';
  const runtimePaused = !workspaceActive || shape.props.runtimePaused === true || localRuntimePaused;
  const frameToken = useMemo(() => {
    const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${shape.id}:${workspaceEpoch ?? 'initial'}:${key}:${random}`;
  }, [shape.id, code, key, workspaceEpoch]);
  const currentStorageRef = useRef<Record<string, string>>(storage || {});
  const storageReconcilerRef = useRef(createArtifactStorageSnapshotReconciler(storage || {}));
  const pendingStorageRef = useRef<Record<string, string> | null>(null);
  const clearedStorageRef = useRef<Record<string, string> | null>(null);
  const storageSessionRef = useRef<ArtifactStorageSession | null>(null);
  const networkWorkspaceEpoch = storageSessionRef.current?.epoch ?? workspaceEpoch;
  const networkHydrationMatches = networkHydration?.shapeId === shape.id &&
    networkHydration.source === (code || '') &&
    networkHydration.epoch === (networkWorkspaceEpoch ?? UNCONFIRMED_NETWORK_EPOCH);
  const networkPermissionsReady = networkHydrationMatches && networkHydration.status === 'ready';
  const rememberedSiteOrigins = networkPermissionsReady ? networkHydration.rememberedOrigins : [];
  const rememberedPeerConnections = networkPermissionsReady && networkHydration.rememberedPeerConnections;
  const activeNetworkOrigins = useMemo(
    () => dedupeArtifactNetworkHints([...rememberedSiteOrigins, ...sessionSiteOrigins]).map(({ origin }) => origin),
    [rememberedSiteOrigins, sessionSiteOrigins]
  );
  const peerConnectionsAllowed = rememberedPeerConnections || sessionPeerConnections;
  const unconfirmedStorageRef = useRef<Record<string, string> | null>(null);
  const storageAcknowledgementRef = useRef(createArtifactStorageAcknowledgementTracker());
  const persistStorageRef = useRef<(next: Record<string, string>) => Promise<boolean>>(() => Promise.resolve(false));
  const foreignWorkspaceChangeRef = useRef(false);
  const storageTransitionRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef(editor);
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    const previous = previousNetworkContextRef.current;
    if (previous.shapeId === shape.id && previous.code !== (code || '')) {
      const epoch = previous.epoch ?? UNCONFIRMED_NETWORK_EPOCH;
      const appIdentity = {
        workspaceKey: ARTIFACT_STORAGE_WORKSPACE_KEY,
        epoch,
        shapeId: shape.id,
      };
      clearArtifactNetworkSessionGrantsForApp(appIdentity);
      sourceGrantClearRef.current = clearArtifactNetworkGrantsForApp(appIdentity);
    } else if (previous.shapeId === shape.id && previous.epoch !== workspaceEpoch && previous.epoch !== null) {
      clearArtifactNetworkSessionGrantsForApp({
        workspaceKey: ARTIFACT_STORAGE_WORKSPACE_KEY,
        epoch: previous.epoch,
        shapeId: shape.id,
      });
    }
    previousNetworkContextRef.current = { shapeId: shape.id, code: code || '', epoch: workspaceEpoch };
    setNetworkHints([]);
    setNetworkDialogOpen(false);
    setNetworkPermissionError(null);
    setShowNetworkAllowAnyway(false);
    networkChoiceWithoutStorageRef.current = null;
    setPendingExternalLink(null);
    setNavigationBlocked(false);
    setExternalLinkError(null);
    setPeerConnectionRequested(false);
    setNetworkHydration(null);
    setSessionSiteOrigins([]);
    setSessionPeerConnections(false);
  }, [shape.id, code, workspaceEpoch]);

  useEffect(() => {
    const source = code || '';
    const isUnconfirmedRun = storageHydrationMatches &&
      storageHydration?.status === 'ready' &&
      storageHydration.allowedUnconfirmedRun;
    const epoch = networkWorkspaceEpoch ?? (isUnconfirmedRun ? UNCONFIRMED_NETWORK_EPOCH : null);
    if (epoch === null || (!storageHydrationReady && !isUnconfirmedRun)) return;

    let active = true;
    setNetworkHydration({
      shapeId: shape.id,
      source,
      epoch,
      status: 'loading',
      identity: null,
      rememberedOrigins: [],
      rememberedPeerConnections: false,
      canRemember: false,
    });
    void (async () => {
      const sourceClear = await sourceGrantClearRef.current.catch(() => null) as { status?: string } | null;
      const sourcePermissionsCleared = !sourceClear ||
        sourceClear.status === 'removed' || sourceClear.status === 'not-found';
      const identity = await createArtifactNetworkGrantIdentity({
        workspaceKey: ARTIFACT_STORAGE_WORKSPACE_KEY,
        epoch,
        shapeId: shape.id,
        source,
      });
      if (!active) return;
      const current = editorRef.current?.getShape(shape.id);
      const currentArtifact = current?.type === 'artifact' ? current as TLArtifactShape : null;
      if (!currentArtifact || currentArtifact.props.code !== source) return;
      const isDurablyScoped = networkWorkspaceEpoch === epoch && !isUnconfirmedRun;
      const remembered = identity && isDurablyScoped && sourcePermissionsCleared
        ? readArtifactNetworkGrants(identity)
        : { status: 'unavailable' as const };
      const session = identity ? readArtifactNetworkSessionPermissions(identity) : { origins: [], peerConnections: false };
      setSessionSiteOrigins(session.origins);
      setSessionPeerConnections(session.peerConnections);
      setNetworkHydration({
        shapeId: shape.id,
        source,
        epoch,
        status: 'ready',
        identity,
        rememberedOrigins: remembered.status === 'available' ? remembered.origins : [],
        rememberedPeerConnections: remembered.status === 'available' && remembered.peerConnections,
        canRemember: isDurablyScoped && sourcePermissionsCleared && remembered.status === 'available',
      });
    })().catch(() => {
      if (!active) return;
      setNetworkHydration({
        shapeId: shape.id,
        source,
        epoch,
        status: 'ready',
        identity: null,
        rememberedOrigins: [],
        rememberedPeerConnections: false,
        canRemember: false,
      });
    });
    return () => { active = false; };
  }, [shape.id, code, networkWorkspaceEpoch, storageHydrationReady, storageHydrationMatches, storageHydration?.allowedUnconfirmedRun, storageHydration?.status]);

  useEffect(() => {
    if (!networkPermissionsReady || !networkHydration?.identity) return;
    const identity = networkHydration.identity;
    return subscribeArtifactNetworkPermissionInvalidations((invalidation: ArtifactNetworkPermissionInvalidation) => {
      if (
        invalidation.workspaceKey !== identity.workspaceKey ||
        invalidation.epoch !== identity.epoch ||
        invalidation.shapeId !== identity.shapeId
      ) return;

      if ('scope' in invalidation && invalidation.scope === 'app') {
        clearArtifactNetworkSessionGrantsForApp(invalidation);
        setNetworkHydration((current) => current?.identity && current.identity.epoch === identity.epoch && current.identity.shapeId === identity.shapeId
          ? { ...current, rememberedOrigins: [], rememberedPeerConnections: false }
          : current);
        setSessionSiteOrigins([]);
        setSessionPeerConnections(false);
        setLocalRuntimePaused(true);
        setKey((value) => value + 1);
        return;
      }

      if ('feature' in invalidation && invalidation.sourceFingerprint === identity.sourceFingerprint) {
        forgetArtifactNetworkSessionPeerConnections(identity);
        setNetworkHydration((current) => current?.identity?.sourceFingerprint === identity.sourceFingerprint
          ? { ...current, rememberedPeerConnections: false }
          : current);
        setSessionPeerConnections(false);
        setLocalRuntimePaused(true);
        setKey((value) => value + 1);
        return;
      }

      if ('origin' in invalidation && invalidation.sourceFingerprint === identity.sourceFingerprint) {
        forgetArtifactNetworkSessionSite(identity, invalidation.origin);
        setNetworkHydration((current) => current?.identity?.sourceFingerprint === identity.sourceFingerprint
          ? { ...current, rememberedOrigins: current.rememberedOrigins.filter((origin) => origin !== invalidation.origin) }
          : current);
        setSessionSiteOrigins((origins) => origins.filter((origin) => origin !== invalidation.origin));
        setLocalRuntimePaused(true);
        setKey((value) => value + 1);
      }
    });
  }, [networkPermissionsReady, networkHydration?.identity]);

  // Keep the synchronous canvas value current; the IndexedDB sidecar is
  // separately acknowledged only after its transaction completes.
  useEffect(() => {
    const validated = validateStorageSnapshot(storage || {});
    if (validated.status === 'accepted') {
      currentStorageRef.current = storageReconcilerRef.current.observeBoardSnapshot(validated.storage);
    } else if (validated.status === 'rejected') {
      currentStorageRef.current = {};
      storageReconcilerRef.current.reset({});
      setStorageStatus({
        kind: 'error',
        message: storageRejectionMessage(validated.reason),
      });
    }
  }, [storage]);

  useEffect(() => {
    const handleWorkspaceEpoch = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceKey?: string; epoch?: number; foreignTab?: boolean }>).detail;
      if (detail?.workspaceKey !== ARTIFACT_STORAGE_WORKSPACE_KEY || !Number.isSafeInteger(detail.epoch)) return;
      if (detail.foreignTab) {
        foreignWorkspaceChangeRef.current = true;
        storageTransitionRef.current = true;
        storageSessionRef.current = null;
        setStorageHydration({
          shapeId: shape.id,
          source: code || '',
          epoch: workspaceEpoch,
          status: 'error',
          allowedUnconfirmedRun: false,
        });
        setStorageStatus({
          kind: 'error',
          message: 'Workspace changed in another tab. Reload this tab before saving app data.',
        });
        return;
      }
      foreignWorkspaceChangeRef.current = false;
      storageTransitionRef.current = true;
      storageSessionRef.current = null;
      unconfirmedStorageRef.current = null;
      setStorageHydration(null);
      setWorkspaceEpoch(detail.epoch!);
    };
    window.addEventListener(getArtifactStorageEpochEventName(), handleWorkspaceEpoch);
    return () => window.removeEventListener(getArtifactStorageEpochEventName(), handleWorkspaceEpoch);
  }, [shape.id, code, workspaceEpoch]);

  useEffect(() => {
    if (foreignWorkspaceChangeRef.current) return;
    let active = true;
    storageSessionRef.current = null;
    pendingStorageRef.current = null;
    unconfirmedStorageRef.current = null;
    storageAcknowledgementRef.current.reset();
    setStorageHydration({
      shapeId: shape.id,
      source: code || '',
      epoch: workspaceEpoch,
      status: 'loading',
      allowedUnconfirmedRun: false,
    });
    const boardStorage = validateStorageSnapshot(storage || {});
    const initialBoardStorage = boardStorage.status === 'accepted' ? boardStorage.storage : {};
    currentStorageRef.current = storageReconcilerRef.current.reset(initialBoardStorage);
    setHasClearUndo(false);
    clearedStorageRef.current = null;
    setStorageStatus({ kind: 'saving', message: 'Checking app data on this device…' });

    void (async () => {
      try {
        const sourceFingerprint = await artifactSourceFingerprint(code || '');
        if (!active || foreignWorkspaceChangeRef.current) return;
        const initial = currentStorageRef.current;
        const recovered = await activateDurableArtifactStorage(
          ARTIFACT_STORAGE_WORKSPACE_KEY,
          shape.id,
          sourceFingerprint,
          initial,
          () => active && !foreignWorkspaceChangeRef.current
        );
        if (!active) return;
        if (!recovered || recovered.status !== 'active' || recovered.generation === null) {
          setStorageHydration({
            shapeId: shape.id,
            source: code || '',
            epoch: workspaceEpoch,
            status: 'error',
            allowedUnconfirmedRun: false,
          });
          setStorageStatus({ kind: 'error', message: 'App data could not be confirmed on this device. Review the warning before running this app.' });
          return;
        }
        const session = {
          epoch: recovered.epoch,
          generation: recovered.generation,
          sourceFingerprint,
        };
        storageSessionRef.current = session;
        storageTransitionRef.current = false;
        clearedStorageRef.current = recovered.undoStorage;
        setHasClearUndo(!!recovered.undoStorage);
        const unconfirmed = unconfirmedStorageRef.current;
        if (recovered.storage && !unconfirmed) {
          currentStorageRef.current = storageReconcilerRef.current.adoptRecovery(recovered.storage);
          if (!sameArtifactStorage(initial, recovered.storage)) {
            onUpdateRef.current({ storage: recovered.storage });
            setKey((value) => value + 1);
          }
        }
        if (unconfirmed) {
          unconfirmedStorageRef.current = null;
          persistStorageRef.current(unconfirmed);
        } else {
          setStorageStatus({
            kind: recovered.corrupted ? 'error' : 'saved',
            message: recovered.corrupted
              ? 'Damaged app recovery data was ignored; current workspace data was saved on this device.'
              : 'App data saved on this device.',
          });
        }
        setStorageHydration({
          shapeId: shape.id,
          source: code || '',
          epoch: workspaceEpoch,
          status: 'ready',
          allowedUnconfirmedRun: false,
        });
      } catch (error) {
        if (!active) return;
        setStorageHydration({
          shapeId: shape.id,
          source: code || '',
          epoch: workspaceEpoch,
          status: 'error',
          allowedUnconfirmedRun: false,
        });
        setStorageStatus({
          kind: 'error',
          message: error instanceof Error
            ? `App data could not be confirmed on this device: ${error.message}`
            : 'App data could not be confirmed on this device.',
        });
      }
    })();

    return () => { active = false; };
  }, [shape.id, code, workspaceEpoch]);

  useEffect(() => {
    if (!editor) return;
    return subscribeToShapeEditing(shape.id, () => {
      const current = editor.getShape(shape.id);
      if (
        !current ||
        current.type !== 'artifact' ||
        editor.getIsReadonly() ||
        editor.isShapeOrAncestorLocked(shape.id)
      ) return;
      setViewMode('code');
    });
  }, [editor, shape.id]);

  useEffect(() => {
    if (!editor) return;
    let deletionQueued = false;
    return editor.store.listen(() => {
      if (deletionQueued || editor.getShape(shape.id)) return;
      deletionQueued = true;
      const session = storageSessionRef.current;
      if (!session) return;
      void deleteDurableArtifactStorage(
        ARTIFACT_STORAGE_WORKSPACE_KEY,
        shape.id,
        session.epoch,
        session.generation,
        () => storageSessionRef.current === session && !foreignWorkspaceChangeRef.current
      ).catch(() => {
        // The primary board snapshot still records deletion. A later restore
        // moves app data to a fresh epoch, so this stale sidecar cannot attach
        // itself to an imported workspace.
      });
    });
  }, [editor, shape.id]);

  const persistStorageSnapshot = useCallback((
    next: Record<string, string>,
    pendingRevision = storageAcknowledgementRef.current.currentRevision()
  ): Promise<boolean> => {
    const session = storageSessionRef.current;
    if (!session || foreignWorkspaceChangeRef.current) {
      if (!foreignWorkspaceChangeRef.current) {
        unconfirmedStorageRef.current = next;
        setStorageStatus({ kind: 'error', message: 'App data is waiting for device storage confirmation.' });
      }
      return Promise.resolve(false);
    }
    const expectedGeneration = session.generation;
    setStorageStatus({ kind: 'saving', message: 'Saving app data on this device…' });
    return saveDurableArtifactStorage(
      ARTIFACT_STORAGE_WORKSPACE_KEY,
      shape.id,
      session.epoch,
      expectedGeneration,
      session.sourceFingerprint,
      next,
      () => storageSessionRef.current === session && !foreignWorkspaceChangeRef.current
    ).then((result) => {
      if (storageSessionRef.current !== session || session.generation !== expectedGeneration || foreignWorkspaceChangeRef.current) return false;
      if (result.status === 'saved') {
        storageAcknowledgementRef.current.confirm(pendingRevision);
      }
      if (!storageAcknowledgementRef.current.isCurrent(pendingRevision)) return false;
      setStorageStatus(result.status === 'saved'
        ? { kind: 'saved', message: 'App data saved on this device.' }
        : { kind: 'error', message: 'App data changed elsewhere and was not confirmed on this device.' });
      return result.status === 'saved';
    }).catch((error: unknown) => {
      if (storageSessionRef.current === session && session.generation === expectedGeneration && !foreignWorkspaceChangeRef.current && storageAcknowledgementRef.current.isCurrent(pendingRevision)) {
        setStorageStatus({
          kind: 'error',
          message: error instanceof Error
            ? `App data could not be confirmed on this device: ${error.message}`
            : 'App data could not be confirmed on this device.',
        });
      }
      return false;
    });
  }, [shape.id]);

  useEffect(() => {
    persistStorageRef.current = persistStorageSnapshot;
  }, [persistStorageSnapshot]);

  // Flush any pending virtual storage updates immediately
  const flushStorageUpdate = useCallback(async (): Promise<boolean> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingStorageRef.current) {
      const pending = pendingStorageRef.current;
      pendingStorageRef.current = null;
      try {
        onUpdateRef.current({ storage: pending });
        return await persistStorageSnapshot(pending, storageAcknowledgementRef.current.currentRevision());
      } catch {
        setStorageStatus({
          kind: 'error',
          message: 'App data could not be accepted by the workspace.',
        });
        return false;
      }
    }
    return true;
  }, [persistStorageSnapshot]);

  const isCurrentNetworkContext = useCallback((
    expectedSource: string,
    expectedEpoch: number,
    requireEditable: boolean
  ) => {
    const activeEditor = editorRef.current;
    const current = activeEditor?.getShape(shape.id);
    const currentArtifact = current?.type === 'artifact' ? current as TLArtifactShape : null;
    const currentEpoch = storageSessionRef.current?.epoch ?? workspaceEpoch ?? UNCONFIRMED_NETWORK_EPOCH;
    const explicitlyRunningUnconfirmedStorage =
      storageHydrationMatches &&
      storageHydration?.status === 'ready' &&
      storageHydration.allowedUnconfirmedRun &&
      storageHydration.source === expectedSource &&
      currentEpoch === expectedEpoch;
    if (
      !activeEditor ||
      !currentArtifact ||
      currentArtifact.props.code !== expectedSource ||
      currentEpoch !== expectedEpoch ||
      foreignWorkspaceChangeRef.current ||
      (storageTransitionRef.current && !explicitlyRunningUnconfirmedStorage)
    ) return false;
    if (requireEditable && (activeEditor.getIsReadonly() || activeEditor.isShapeOrAncestorLocked(shape.id))) return false;
    return true;
  }, [shape.id, workspaceEpoch, storageHydrationMatches, storageHydration?.status, storageHydration?.allowedUnconfirmedRun, storageHydration?.source]);

  const requestCurrentStorageFlush = useCallback(async (
    expectedSource: string,
    expectedEpoch: number
  ): Promise<{ received: boolean; accepted: boolean; durable: boolean }> => {
    if (!isCurrentNetworkContext(expectedSource, expectedEpoch, false)) return { received: false, accepted: false, durable: false };
    const frame = iframeRef.current;
    if (runtimePaused || viewMode !== 'preview' || !frame) {
      const flushed = await flushStorageUpdate();
      const durable = flushed && await persistStorageSnapshot(
        currentStorageRef.current,
        storageAcknowledgementRef.current.currentRevision()
      );
      const live = editorRef.current?.getShape(shape.id);
      const liveArtifact = live?.type === 'artifact' ? live as TLArtifactShape : null;
      const accepted = flushed && Boolean(liveArtifact) &&
        sameArtifactStorage(liveArtifact?.props.storage || {}, currentStorageRef.current);
      return { received: false, accepted, durable };
    }
    const explicitlyRunningUnconfirmedStorage =
      storageHydrationMatches &&
      storageHydration?.status === 'ready' &&
      storageHydration.allowedUnconfirmedRun &&
      storageHydration.source === expectedSource;
    if ((!storageSessionRef.current && !explicitlyRunningUnconfirmedStorage) || foreignWorkspaceChangeRef.current) {
      return { received: false, accepted: false, durable: false };
    }
    const target = frame.contentWindow;
    if (!target) return { received: false, accepted: false, durable: false };
    const requestId = `network-flush:${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
    const storageSnapshot = await new Promise<Record<string, string> | null>((resolve) => {
      const timer = setTimeout(() => {
        if (pendingNetworkFlushRef.current?.requestId === requestId) pendingNetworkFlushRef.current = null;
        resolve(null);
      }, NETWORK_FLUSH_TIMEOUT_MS);
      pendingNetworkFlushRef.current = { requestId, frameToken, resolve, timer };
      try {
        target.postMessage({
          type: 'VISIONOS_STORAGE_FLUSH_REQUEST',
          shapeId: shape.id,
          frameToken,
          requestId,
        }, '*');
      } catch {
        clearTimeout(timer);
        pendingNetworkFlushRef.current = null;
        resolve(null);
      }
    });
    if (!storageSnapshot || !isCurrentNetworkContext(expectedSource, expectedEpoch, false)) {
      return { received: false, accepted: false, durable: false };
    }
    const validated = validateStorageSnapshot(storageSnapshot);
    if (validated.status !== 'accepted') {
      setStorageStatus({
        kind: 'error',
        message: validated.status === 'rejected'
          ? storageRejectionMessage(validated.reason)
          : 'App data could not be confirmed by the running app.',
      });
      return { received: true, accepted: false, durable: false };
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingStorageRef.current = null;
    currentStorageRef.current = validated.storage;
    const pendingRevision = storageAcknowledgementRef.current.markPending();
    try {
      onUpdateRef.current({ storage: validated.storage });
    } catch {
      setStorageStatus({ kind: 'error', message: 'App data could not be accepted by the workspace.' });
      return { received: true, accepted: false, durable: false };
    }
    const live = editorRef.current?.getShape(shape.id);
    const liveArtifact = live?.type === 'artifact' ? live as TLArtifactShape : null;
    if (!liveArtifact || !sameArtifactStorage(liveArtifact.props.storage || {}, validated.storage)) {
      setStorageStatus({ kind: 'error', message: 'App data could not be confirmed by the workspace.' });
      return { received: true, accepted: false, durable: false };
    }
    const durable = await persistStorageSnapshot(validated.storage, pendingRevision);
    return { received: true, accepted: true, durable };
  }, [flushStorageUpdate, frameToken, isCurrentNetworkContext, persistStorageSnapshot, runtimePaused, shape.id, viewMode, storageHydrationMatches, storageHydration?.status, storageHydration?.allowedUnconfirmedRun, storageHydration?.source]);

  useEffect(() => () => {
    const pending = pendingNetworkFlushRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(null);
    pendingNetworkFlushRef.current = null;
  }, []);

  useEffect(() => registerArtifactStorageWorkspaceFlusher(
    ARTIFACT_STORAGE_WORKSPACE_KEY,
    flushStorageUpdate
  ), [flushStorageUpdate]);

  // Listen for storage mutations and zoom gestures from the sandboxed iframe virtual environment
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) return;
      if (!event.data || typeof event.data !== 'object' || event.data.frameToken !== frameToken) return;
      if (
        event.data.type === 'VISIONOS_STORAGE_FLUSH_ACK' &&
        event.data.shapeId === shape.id &&
        typeof event.data.requestId === 'string'
      ) {
        const pending = pendingNetworkFlushRef.current;
        if (
          !pending ||
          pending.requestId !== event.data.requestId ||
          pending.frameToken !== frameToken
        ) return;
        clearTimeout(pending.timer);
        pendingNetworkFlushRef.current = null;
        pending.resolve(event.data.storage && typeof event.data.storage === 'object' && !Array.isArray(event.data.storage)
          ? event.data.storage as Record<string, string>
          : null);
        return;
      }
      if (runtimePaused) return;

      const networkHint = validateArtifactNetworkHintMessage(
        event.data,
        event.source,
        iframeWindow,
        shape.id,
        frameToken
      );
      if (networkHint.status === 'accepted') {
        setNetworkHints((hints) => dedupeArtifactNetworkHints([...hints, networkHint.hint]));
        return;
      }

      if (
        event.data.type === 'VISIONOS_FEATURE_BLOCKED' &&
        event.data.shapeId === shape.id &&
        event.data.frameToken === frameToken &&
        event.data.feature === 'peer-to-peer'
      ) {
        setPeerConnectionRequested(true);
        return;
      }

      const externalLink = validateArtifactExternalLinkMessage(
        event.data,
        event.source,
        iframeWindow,
        shape.id,
        frameToken
      );
      if (externalLink.status === 'accepted') {
        setPendingExternalLink((pending) => pending ?? externalLink.link);
        setExternalLinkError(null);
        return;
      }

      if (isArtifactNavigationBlockedMessage(event.data, event.source, iframeWindow, shape.id, frameToken)) {
        setNavigationBlocked(true);
        return;
      }

      if (
        event.data.type === 'VISIONOS_STORAGE_PENDING' &&
        event.data.shapeId === shape.id
      ) {
        if (storageTransitionRef.current || foreignWorkspaceChangeRef.current) return;
        storageAcknowledgementRef.current.markPending();
        setStorageStatus({ kind: 'saving', message: 'Saving app data…' });
        return;
      }

      // 1. Intercept iframe pinch-to-zoom (trackpad pinch or Ctrl/Meta+wheel) and forward to canvas camera
      if (
        event.data &&
        event.data.type === 'CANVASOS_IFRAME_PINCH_ZOOM' &&
        event.data.shapeId === shape.id
      ) {
        const ed = editorRef.current;
        const iframe = iframeRef.current;
        if (!ed || !iframe) return;

        const rect = iframe.getBoundingClientRect();
        const iframeW = iframe.clientWidth || rect.width || 1;
        const iframeH = iframe.clientHeight || rect.height || 1;

        // Map relative cursor position in iframe to physical client screen coordinates
        const fractionX = Math.max(0, Math.min(1, (event.data.clientX ?? 0) / iframeW));
        const fractionY = Math.max(0, Math.min(1, (event.data.clientY ?? 0) / iframeH));
        const screenX = rect.left + fractionX * rect.width;
        const screenY = rect.top + fractionY * rect.height;

        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;

        let dy = Number(event.data.deltaY) || 0;
        if (event.data.deltaMode === 1) {
          dy *= 16;
        } else if (event.data.deltaMode === 2) {
          dy *= iframeH;
        }

        const clampedDy = Math.max(-120, Math.min(120, dy));
        const { x: cx, y: cy, z: cz } = ed.getCamera();

        // Standard zoom factor calculation: negative deltaY = zoom in (pinch out)
        const zoomFactor = Math.exp(-clampedDy * 0.008);
        const nextZ = Math.min(8.0, Math.max(0.05, cz * zoomFactor));

        if (Math.abs(nextZ - cz) > 0.0001) {
          // Convert anchor screen point to page space
          const pPage = ed.screenToPage({ x: screenX, y: screenY });

          // Compute new camera position anchoring the point under cursor
          const nextCx = ((pPage.x + cx) * cz) / nextZ - pPage.x;
          const nextCy = ((pPage.y + cy) * cz) / nextZ - pPage.y;

          ed.setCamera({ x: nextCx, y: nextCy, z: nextZ }, { immediate: true });
        }
        return;
      }

      if (
        event.data &&
        event.data.type === 'VISIONOS_STORAGE_REJECTED' &&
        event.data.shapeId === shape.id
      ) {
        const reason =
          event.data.reason === 'too-many-keys' || event.data.reason === 'too-large'
            ? event.data.reason
            : 'invalid';
        setStorageStatus({
          kind: 'error',
          message: storageRejectionMessage(reason),
        });
        return;
      }

      if (storageTransitionRef.current || foreignWorkspaceChangeRef.current) return;

      const validation = validateStorageMessage(
        event.data,
        event.source,
        iframeWindow,
        shape.id,
        frameToken
      );
      if (validation.status === 'ignored') return;
      if (validation.status === 'rejected') {
        setStorageStatus({
          kind: 'error',
          message: storageRejectionMessage(validation.reason),
        });
        return;
      }
      const next = validation.storage;

      // Update immediate memory ref
      currentStorageRef.current = next;

      // Content-equality check against current props or pending update
      const currentSnapshot = pendingStorageRef.current || shape.props.storage || {};
      const currentKeys = Object.keys(currentSnapshot);
      const nextKeys = Object.keys(next);
      if (
        currentKeys.length === nextKeys.length &&
        currentKeys.every((k) => currentSnapshot[k] === next[k])
      ) {
        const alreadyQueuedForCanvas = pendingStorageRef.current !== null;
        if ((event.data as { flush?: boolean }).flush) flushStorageUpdate();
        if (
          storageAcknowledgementRef.current.needsConfirmation(alreadyQueuedForCanvas)
        ) {
          // A burst can change a value and then return it to its original
          // value before the full snapshot reaches the host. The board data
          // is unchanged, but only an IDB transaction can clear its pending
          // status truthfully.
          persistStorageSnapshot(next, storageAcknowledgementRef.current.currentRevision());
        }
        return;
      }

      pendingStorageRef.current = next;
      setStorageStatus({ kind: 'saving', message: 'Saving app data…' });

      if ((event.data as { flush?: boolean }).flush) {
        flushStorageUpdate();
        return;
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        flushStorageUpdate();
      }, 300);
    };

    const flushWhenHidden = () => flushStorageUpdate();
    const flushOnVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushStorageUpdate();
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('pagehide', flushWhenHidden);
    document.addEventListener('visibilitychange', flushOnVisibilityChange);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('pagehide', flushWhenHidden);
      document.removeEventListener('visibilitychange', flushOnVisibilityChange);
      flushStorageUpdate();
    };
  }, [shape.id, shape.props.storage, code, frameToken, runtimePaused, flushStorageUpdate]);

  const handleClearStorage = (e: React.MouseEvent) => {
    e.stopPropagation();
    const current = currentStorageRef.current;
    if (!Object.keys(current).length) return;
    const confirmed = window.confirm(
      `Clear ${Object.keys(current).length} saved app data key${Object.keys(current).length === 1 ? '' : 's'}? The latest clear can be undone after reload; clearing again replaces that undo.`
    );
    if (!confirmed) return;
    const session = storageSessionRef.current;
    if (!session || foreignWorkspaceChangeRef.current) {
      setStorageStatus({ kind: 'error', message: 'App data is not ready for a durable clear yet.' });
      return;
    }
    const expectedGeneration = session.generation;
    unconfirmedStorageRef.current = null;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingStorageRef.current = null;
    setStorageStatus({ kind: 'saving', message: 'Clearing app data on this device…' });
    void clearDurableArtifactStorage(
      ARTIFACT_STORAGE_WORKSPACE_KEY,
      shape.id,
      session.epoch,
      expectedGeneration,
      session.sourceFingerprint,
      current,
      () => storageSessionRef.current === session && !foreignWorkspaceChangeRef.current
    ).then((result) => {
      if (storageSessionRef.current !== session || session.generation !== expectedGeneration || foreignWorkspaceChangeRef.current) return;
      if (result.status !== 'saved') {
        setStorageStatus({ kind: 'error', message: 'App data changed elsewhere; the clear was not applied.' });
        return;
      }
      session.generation = result.generation;
      clearedStorageRef.current = { ...current };
      currentStorageRef.current = {};
      setHasClearUndo(true);
      onUpdateRef.current({ storage: {} });
      setStorageStatus({ kind: 'cleared', message: 'App data cleared on this device. Undo is available after reload.' });
      setKey((k) => k + 1);
    }).catch((error: unknown) => {
      if (storageSessionRef.current !== session) return;
      setStorageStatus({
        kind: 'error',
        message: error instanceof Error ? `App data could not be cleared: ${error.message}` : 'App data could not be cleared.',
      });
    });
  };

  const handleUndoClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    const restored = clearedStorageRef.current;
    if (!restored) return;
    if (
      Object.keys(currentStorageRef.current).length > 0 &&
      !window.confirm('Restore the cleared app data and replace the data currently in use?')
    ) {
      return;
    }
    const session = storageSessionRef.current;
    if (!session || foreignWorkspaceChangeRef.current) {
      setStorageStatus({ kind: 'error', message: 'App data is not ready for durable undo yet.' });
      return;
    }
    const expectedGeneration = session.generation;
    setStorageStatus({ kind: 'saving', message: 'Restoring cleared app data on this device…' });
    void undoDurableArtifactStorageClear(
      ARTIFACT_STORAGE_WORKSPACE_KEY,
      shape.id,
      session.epoch,
      expectedGeneration,
      session.sourceFingerprint,
      restored,
      () => storageSessionRef.current === session && !foreignWorkspaceChangeRef.current
    ).then((result) => {
      if (storageSessionRef.current !== session || session.generation !== expectedGeneration || foreignWorkspaceChangeRef.current) return;
      if (result.status !== 'saved') {
        setStorageStatus({ kind: 'error', message: 'App data changed elsewhere; undo was not applied.' });
        return;
      }
      session.generation = result.generation;
      clearedStorageRef.current = null;
      currentStorageRef.current = restored;
      setHasClearUndo(false);
      onUpdateRef.current({ storage: restored });
      setStorageStatus({ kind: 'saved', message: 'Cleared app data restored on this device; current data was replaced.' });
      setKey((k) => k + 1);
    }).catch((error: unknown) => {
      if (storageSessionRef.current !== session) return;
      setStorageStatus({
        kind: 'error',
        message: error instanceof Error ? `App data could not be restored: ${error.message}` : 'App data could not be restored.',
      });
    });
  };

  const storageCount = Object.keys(storage || {}).length;

  // Keep the iframe document stable while storage props change. A storage flush
  // updates canvas state without interrupting the app's current interaction.
  const childSrcDoc = useMemo(
    () =>
      buildArtifactSrcDoc(
        code || '',
        shape.id,
        currentStorageRef.current,
        activeNetworkOrigins,
        frameToken,
        peerConnectionsAllowed
      ),
    // Storage snapshots are bridged without reloading the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, code, shape.id, activeNetworkOrigins, frameToken, peerConnectionsAllowed]
  );
  const srcDoc = useMemo(() => buildArtifactBoundarySrcDoc({
    childSrcDoc,
    shapeId: shape.id,
    frameToken,
    origins: activeNetworkOrigins,
    allowPeerConnections: peerConnectionsAllowed,
  }), [activeNetworkOrigins, childSrcDoc, frameToken, peerConnectionsAllowed, shape.id]);

  const codeDraft = useShapeDraft<string>(
    `artifact:${shape.id}:source`,
    stripMarkdownFences(code || ''),
    {
      editor,
      shapeId: shape.id,
      validateRecovered: (candidate) =>
        typeof candidate === 'string' && candidate.length <= 300_000,
    }
  );
  useEffect(() => {
    if (codeDraft.recovered) setViewMode('code');
  }, [codeDraft.recovered]);

  const canEditSource = () => {
    const activeEditor = editorRef.current;
    const current = activeEditor?.getShape(shape.id);
    if (!activeEditor || !current || current.type !== 'artifact') return false;
    return !activeEditor.getIsReadonly() && !activeEditor.isShapeOrAncestorLocked(shape.id);
  };

  const requestedNetworkOrigins = useMemo(
    () => networkHints.map(({ origin }) => origin).filter((origin) => !activeNetworkOrigins.includes(origin)),
    [activeNetworkOrigins, networkHints]
  );
  const unreviewedNetworkRequestCount = requestedNetworkOrigins.length +
    (peerConnectionRequested && !peerConnectionsAllowed ? 1 : 0);

  type NetworkChoice = {
    origins: string[];
    rememberOrigins: boolean;
    allowPeerConnections: boolean;
    rememberPeerConnections: boolean;
  };

  const openNetworkAccess = useCallback(() => {
    if (!networkPermissionsReady) {
      setNetworkPermissionError(storageHydrationMatches && storageHydration?.status === 'error'
        ? storageStatus?.message || 'App data could not be confirmed on this device.'
        : 'Website access is still being prepared. Try again in a moment.');
      return;
    }
    if (!networkHydration?.identity) {
      setNetworkPermissionError('Website permissions could not be prepared. Open this app over HTTPS or localhost and reload.');
      return;
    }
    setNetworkPermissionError(null);
    setShowNetworkAllowAnyway(false);
    networkChoiceWithoutStorageRef.current = null;
    setNetworkDialogOpen(true);
  }, [networkPermissionsReady, networkHydration?.identity, storageHydrationMatches, storageHydration?.status, storageStatus?.message]);

  useEffect(() => subscribeToArtifactNetworkReview(shape.id, openNetworkAccess), [shape.id, openNetworkAccess]);

  const applyNetworkChoice = async (choice: NetworkChoice, allowAnyway = false) => {
    const identity = networkHydration?.identity;
    const expectedSource = code || '';
    const expectedEpoch = networkHydration?.epoch;
    const staged = networkChoiceWithoutStorageRef.current;
    if (
      !identity ||
      expectedEpoch === undefined ||
      !networkPermissionsReady ||
      !isCurrentNetworkContext(expectedSource, expectedEpoch, true) ||
      !canEditSource()
    ) {
      setNetworkPermissionError('Unlock this app and make sure its source has not changed before allowing access.');
      setShowNetworkAllowAnyway(false);
      networkChoiceWithoutStorageRef.current = null;
      return;
    }
    if (allowAnyway && (!staged || staged.source !== expectedSource || staged.epoch !== expectedEpoch)) {
      setNetworkPermissionError('This access request is out of date. Review it again before continuing.');
      setShowNetworkAllowAnyway(false);
      return;
    }

    const requested = dedupeArtifactNetworkHints(choice.origins).map(({ origin }) => origin);
    if (requested.length !== choice.origins.length) {
      setNetworkPermissionError('One of the selected sites is not a valid HTTPS origin.');
      return;
    }
    const combinedSiteCount = new Set([...activeNetworkOrigins, ...requested]).size;
    if (combinedSiteCount > ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) {
      setNetworkPermissionError('This app can have access to at most 24 sites. Remove one before adding another.');
      return;
    }

    setNetworkPermissionBusy(true);
    setNetworkPermissionError(null);
    // Retry once after the explicit recovery choice so any newer app state is
    // included when possible. If that still cannot be confirmed, the button
    // label and warning authorize discarding pending inputs before reload.
    const flush = canEditSource()
      ? await requestCurrentStorageFlush(expectedSource, expectedEpoch)
      : { received: false, accepted: false, durable: false };
    if (!isCurrentNetworkContext(expectedSource, expectedEpoch, true) || !canEditSource()) {
      setNetworkPermissionBusy(false);
      setNetworkPermissionError('The app changed while access was being reviewed. Open Website access again.');
      setShowNetworkAllowAnyway(false);
      networkChoiceWithoutStorageRef.current = null;
      return;
    }

    if (!flush.durable && !allowAnyway) {
      networkChoiceWithoutStorageRef.current = { source: expectedSource, epoch: expectedEpoch, flush };
      setShowNetworkAllowAnyway(true);
      setNetworkPermissionError('The app kept its current access. You can retry after checking app data, or choose the explicit reload option below.');
      setNetworkPermissionBusy(false);
      return;
    }

    if (allowAnyway && !flush.durable && !flush.accepted) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingStorageRef.current = null;
      const boardSnapshot = validateStorageSnapshot(shape.props.storage || {});
      if (boardSnapshot.status === 'accepted') currentStorageRef.current = boardSnapshot.storage;
      if (!runtimePaused) setLocalRuntimePaused(true);
      setStorageStatus({
        kind: 'error',
        message: runtimePaused
          ? 'The app remains paused and will use board-saved data when you run it.'
          : 'Pending app inputs were discarded; the app will reload from board-saved data.',
      });
    } else if (allowAnyway && !flush.durable && flush.accepted) {
      setStorageStatus({ kind: 'error', message: 'Latest app data was accepted by the board, but device recovery could not be confirmed.' });
    }

    const wantsRemembered =
      (choice.rememberOrigins && requested.length > 0) ||
      (choice.rememberPeerConnections && choice.allowPeerConnections);
    let rememberSucceeded = false;
    let rememberMessage: string | null = null;
    if (wantsRemembered && networkHydration?.canRemember) {
      const saved = await rememberArtifactNetworkChoices(identity, {
        origins: choice.rememberOrigins ? requested : [],
        peerConnections: choice.rememberPeerConnections && choice.allowPeerConnections,
      });
      rememberSucceeded = saved.status === 'saved' || saved.status === 'already-saved';
      if (!rememberSucceeded) rememberMessage = 'This browser could not save the permission choice; access is for this run only.';
    } else if (wantsRemembered) {
      rememberMessage = 'This browser could not save the permission choice; access is for this run only.';
    }

    if (!isCurrentNetworkContext(expectedSource, expectedEpoch, true) || !canEditSource()) {
      await clearArtifactNetworkGrantsForApp({
        workspaceKey: ARTIFACT_STORAGE_WORKSPACE_KEY,
        epoch: expectedEpoch,
        shapeId: shape.id,
      });
      clearArtifactNetworkSessionGrantsForApp({
        workspaceKey: ARTIFACT_STORAGE_WORKSPACE_KEY,
        epoch: expectedEpoch,
        shapeId: shape.id,
      });
      setNetworkPermissionBusy(false);
      setNetworkPermissionError('The app changed before access could be applied. Review the current source first.');
      return;
    }

    const sessionOrigins = choice.rememberOrigins && rememberSucceeded ? [] : requested;
    const sessionPeer = choice.allowPeerConnections && !(choice.rememberPeerConnections && rememberSucceeded);
    const sessionSiteWrite = grantArtifactNetworkSessionSites(identity, sessionOrigins);
    const sessionPeerWrite = sessionPeer
      ? grantArtifactNetworkSessionPeerConnections(identity)
      : { status: 'already-saved' as const };
    if (
      (sessionSiteWrite.status !== 'saved' && sessionSiteWrite.status !== 'already-saved') ||
      (sessionPeerWrite.status !== 'saved' && sessionPeerWrite.status !== 'already-saved')
    ) {
      clearArtifactNetworkSessionGrantsForApp(identity);
      if (rememberSucceeded) {
        await clearArtifactNetworkGrantsForApp({ workspaceKey: identity.workspaceKey, epoch: identity.epoch, shapeId: identity.shapeId });
      }
      setNetworkPermissionBusy(false);
      setNetworkPermissionError('Access could not be applied because this browser has reached its permission limit.');
      return;
    }

    const rememberedOrigins = rememberSucceeded && choice.rememberOrigins
      ? dedupeArtifactNetworkHints([...networkHydration.rememberedOrigins, ...requested]).map(({ origin }) => origin)
      : networkHydration.rememberedOrigins;
    const rememberedPeer = networkHydration.rememberedPeerConnections ||
      (rememberSucceeded && choice.rememberPeerConnections && choice.allowPeerConnections);
    const session = readArtifactNetworkSessionPermissions(identity);
    setNetworkHydration({
      ...networkHydration,
      rememberedOrigins,
      rememberedPeerConnections: rememberedPeer,
      canRemember: networkHydration.canRemember,
    });
    setSessionSiteOrigins(session.origins);
    setSessionPeerConnections(session.peerConnections);
    setNetworkHints((hints) => hints.filter(({ origin }) => !requested.includes(origin)));
    setPeerConnectionRequested(false);
    setNetworkDialogOpen(false);
    setShowNetworkAllowAnyway(false);
    networkChoiceWithoutStorageRef.current = null;
    if (allowAnyway && !shape.props.runtimePaused) setLocalRuntimePaused(false);
    if (rememberMessage) setStorageStatus({ kind: 'error', message: rememberMessage });
    setNetworkPermissionBusy(false);
    setKey((value) => value + 1);
  };

  const revokeNetworkSite = async (origin: string) => {
    const identity = networkHydration?.identity;
    const expectedEpoch = networkHydration?.epoch;
    const expectedSource = code || '';
    if (!identity || expectedEpoch === undefined || !networkPermissionsReady) return;
    setNetworkPermissionBusy(true);
    const flush = canEditSource()
      ? await requestCurrentStorageFlush(expectedSource, expectedEpoch)
      : { received: false, accepted: false, durable: false };
    forgetArtifactNetworkSessionSite(identity, origin);
    setSessionSiteOrigins((origins) => origins.filter((site) => site !== origin));
    setNetworkHydration((current) => current?.identity?.sourceFingerprint === identity.sourceFingerprint
      ? { ...current, rememberedOrigins: current.rememberedOrigins.filter((site) => site !== origin) }
      : current);
    setNetworkHints((hints) => hints.filter((hint) => hint.origin !== origin));
    setKey((value) => value + 1);
    if (!flush.durable) {
      setLocalRuntimePaused(true);
      setStorageStatus({ kind: 'error', message: 'Site access was stopped, but app data could not be confirmed. The app is paused.' });
    }
    const result = await forgetArtifactNetworkGrant(identity, origin);
    if (result.status !== 'removed' && result.status !== 'not-found') {
      setNetworkPermissionError('Site access is stopped for this run, but this browser could not confirm removal for later runs.');
    } else {
      setNetworkPermissionError(null);
    }
    setNetworkPermissionBusy(false);
  };

  const revokePeerConnections = async () => {
    const identity = networkHydration?.identity;
    const expectedEpoch = networkHydration?.epoch;
    const expectedSource = code || '';
    if (!identity || expectedEpoch === undefined || !networkPermissionsReady) return;
    setNetworkPermissionBusy(true);
    const flush = canEditSource()
      ? await requestCurrentStorageFlush(expectedSource, expectedEpoch)
      : { received: false, accepted: false, durable: false };
    forgetArtifactNetworkSessionPeerConnections(identity);
    setSessionPeerConnections(false);
    setNetworkHydration((current) => current?.identity?.sourceFingerprint === identity.sourceFingerprint
      ? { ...current, rememberedPeerConnections: false }
      : current);
    setKey((value) => value + 1);
    if (!flush.durable) {
      setLocalRuntimePaused(true);
      setStorageStatus({ kind: 'error', message: 'Peer-to-peer access was stopped, but app data could not be confirmed. The app is paused.' });
    }
    const result = await setArtifactNetworkPeerConnections(identity, false);
    if (result.status !== 'saved' && result.status !== 'not-found') {
      setNetworkPermissionError('Peer-to-peer access is stopped for this run, but this browser could not confirm removal for later runs.');
    } else {
      setNetworkPermissionError(null);
    }
    setNetworkPermissionBusy(false);
  };

  const openPendingExternalLink = () => {
    const pending = pendingExternalLink;
    if (!pending) return;
    const validated = normalizeArtifactExternalLink(pending.url);
    if (validated.status !== 'accepted' || validated.link.origin !== pending.origin) {
      setExternalLinkError('This link is no longer available.');
      setPendingExternalLink(null);
      return;
    }
    try {
      window.open(validated.link.url, '_blank', 'noopener,noreferrer');
    } catch {
      setExternalLinkError('The browser could not open this link.');
    }
    setPendingExternalLink(null);
  };

  const saveSourceDraft = () => {
    if (!canEditSource()) {
      setStorageStatus({ kind: 'error', message: 'Unlock this app and enable editing before saving source.' });
      return;
    }
    try {
      onUpdate(getArtifactSourceUpdate(codeDraft.value, code || ''));
      const updatedShape = editor?.getShape(shape.id) as
        | TLArtifactShape
        | undefined;
      if (
        !updatedShape ||
        updatedShape.type !== 'artifact' ||
        updatedShape.props.code !== codeDraft.value
      ) {
        setStorageStatus({
          kind: 'error',
          message: 'Source update was not confirmed by the workspace; the draft is still available.',
        });
        return;
      }
      codeDraft.save(codeDraft.value);
      setStorageStatus({ kind: 'saved', message: 'Source accepted by workspace' });
    } catch {
      setStorageStatus({
        kind: 'error',
        message: 'Source could not be accepted by the workspace; the draft is still available.',
      });
    }
  };

  const runPausedApp = () => {
    if (!canEditSource()) {
      setStorageStatus({
        kind: 'error',
        message: 'Unlock this app and enable editing before running it.',
      });
      return;
    }
    if (codeDraft.isDirty) {
      setStorageStatus({
        kind: 'error',
        message: 'Save or discard source edits before running this app.',
      });
      return;
    }
    editorRef.current?.setSelectedShapes([shape.id]);
    setViewMode('preview');
    setLocalRuntimePaused(false);
    onUpdate({ runtimePaused: false });
    setKey((current) => current + 1);
  };

  const reviewSource = () => {
    if (!canEditSource()) return;
    // Reviewing source is an explicit edit action; keep the app selected when
    // the focus layer closes so its preview and controls remain interactive.
    editorRef.current?.setSelectedShapes([shape.id]);
    setViewMode('code');
  };

  const beginPointerIntent = (event: React.PointerEvent) => {
    event.stopPropagation();
    pointerIntentRef.current = startPrimaryPointerIntent(event);
  };

  const updatePointerPosition = (event: React.PointerEvent) => {
    pointerIntentRef.current = updatePointerIntent(pointerIntentRef.current, event);
  };

  const cancelPointerSequence = (event: React.PointerEvent) => {
    pointerIntentRef.current = cancelPointerIntent(pointerIntentRef.current, event.pointerId);
  };

  const runPointerIntent = (event: React.PointerEvent, action: () => void) => {
    event.stopPropagation();
    const intent = pointerIntentRef.current;
    pointerIntentRef.current = null;
    if (!intent || intent.pointerId !== event.pointerId) return;

    // Suppress the synthetic click for both accepted and cancelled pointer
    // sequences. Keyboard-generated clicks remain available through onClick.
    pointerActionHandledRef.current = true;
    window.setTimeout(() => { pointerActionHandledRef.current = false; }, 0);
    if (matchesPrimaryPointerIntent(intent, event)) action();
  };

  const runClickIntent = (event: React.MouseEvent, action: () => void) => {
    event.stopPropagation();
    if (pointerActionHandledRef.current) {
      pointerActionHandledRef.current = false;
      return;
    }
    if (event.button !== 0 || event.detail !== 0) return;
    action();
  };

  const toggleSourceView = () => {
    if (viewMode === 'code') {
      if (codeDraft.isDirty) {
        const discard = window.confirm(
          'Discard the unsaved source draft and return to the app?'
        );
        if (!discard) return;
        codeDraft.discard();
      }
      setViewMode('preview');
    } else {
      if (!canEditSource()) return;
      setViewMode('code');
    }
  };

  const runWithoutStorageConfirmation = () => {
    if (foreignWorkspaceChangeRef.current) return;
    const boardStorage = validateStorageSnapshot(shape.props.storage || {});
    if (boardStorage.status !== 'accepted') {
      setStorageStatus({
        kind: 'error',
        message: boardStorage.status === 'rejected'
          ? storageRejectionMessage(boardStorage.reason)
          : 'Board-saved app data could not be read.',
      });
      return;
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingStorageRef.current = null;
    currentStorageRef.current = boardStorage.storage;
    storageSessionRef.current = null;
    storageTransitionRef.current = false;
    unconfirmedStorageRef.current = null;
    setStorageHydration({
      shapeId: shape.id,
      source: code || '',
      epoch: workspaceEpoch,
      status: 'ready',
      allowedUnconfirmedRun: true,
    });
    setStorageStatus({
      kind: 'error',
      message: 'Running with board-saved app data; device storage is unconfirmed and newer recovery data may be unavailable.',
    });
    setKey((current) => current + 1);
  };

  const pauseRuntime = () => {
    setLocalRuntimePaused(true);
    void flushStorageUpdate();
    onUpdate({ runtimePaused: true });
    setViewMode('preview');
  };

  const reloadRuntime = () => {
    flushStorageUpdate();
    setKey((current) => current + 1);
  };
  return (
    <>
    <HTMLContainer
      id={shape.id}
      className="studio-native-window studio-native-app pointer-events-auto overflow-hidden rounded-2xl transition-colors flex flex-col antialiased"
      style={{
        width: w,
        height: h,
      }}
    >
      {/* Top Window Bar */}
      <div data-window-header="app" className="flex h-11 w-full shrink-0 items-center justify-between liquid-glass-header px-3.5 select-none cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          <AIOrb
            className="h-4 w-4 text-indigo-400 shrink-0"
            strokeWidth={1.5}
          />
          <span
            data-window-title
            className="truncate text-xs font-semibold tracking-wide text-slate-200"
            title={title}
          >
            {title || 'Interactive Sandbox'}
          </span>
          <span className="shrink-0 rounded-md bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9px] font-mono text-slate-400 uppercase tracking-wider">
            {runtimePaused ? 'Paused' : 'Running'}
          </span>

          {storageCount > 0 && (
            <div
              className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300 select-none tabular-nums"
              title={`Virtual app storage: ${storageCount} key${storageCount === 1 ? '' : 's'} in workspace state`}
            >
              <Database className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
              <span>
                <span className="tabular-nums font-semibold">
                  {storageCount}
                </span>{' '}
                keys
              </span>
            </div>
          )}
        </div>

        <ArtifactHeaderActions
          menuLabel="App actions"
          primaryAction={{
            label: viewMode === 'preview' ? 'View/Edit Source Code' : runtimePaused ? 'View paused app' : 'View app',
            icon: viewMode === 'preview' ? <Code /> : <Eye />,
            disabled: viewMode === 'preview' && !canEditSource(),
            onSelect: toggleSourceView,
          }}
          actions={[
            ...(storageCount > 0 ? [{ id: 'clear-storage', label: 'Clear saved virtual storage', icon: <Database />, destructive: true, onSelect: (event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => handleClearStorage(event as React.MouseEvent) }] : []),
            ...(!runtimePaused && viewMode === 'preview' ? [
              { id: 'pause', label: 'Pause app runtime', icon: <Hand />, onSelect: pauseRuntime },
              { id: 'reload', label: 'Reload app', icon: <RotateCcw />, onSelect: reloadRuntime },
            ] : []),
            { id: 'duplicate', label: 'Duplicate app', icon: <Copy />, onSelect: () => editor?.duplicateShapes([shape.id]) },
            { id: 'delete', label: 'Delete app', icon: <Trash2 />, destructive: true, onSelect: () => editor?.deleteShapes([shape.id]) },
          ]}
        />
      </div>

      <div
        data-window-toolbar="app"
        className="flex min-h-11 shrink-0 items-center gap-2 border-b border-white/5 bg-white/[0.025] px-3"
        onPointerDown={stopEventPropagation}
      >
        <button
          type="button"
          onClick={openNetworkAccess}
          disabled={!networkPermissionsReady}
          aria-label={unreviewedNetworkRequestCount > 0 ? `Review ${unreviewedNetworkRequestCount} website or connection request${unreviewedNetworkRequestCount === 1 ? '' : 's'}` : 'Review website access'}
          title="Review exact website access for this app"
          className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${unreviewedNetworkRequestCount > 0 ? 'border-amber-300/25 bg-amber-300/[0.08] text-amber-100 hover:bg-amber-300/[0.12]' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'} disabled:cursor-wait disabled:opacity-55`}
        >
          <Globe className="h-3.5 w-3.5" />
          Website access{unreviewedNetworkRequestCount > 0 ? ` · ${unreviewedNetworkRequestCount} to review` : ''}
        </button>
        <button
          type="button"
          onClick={() => setCanvasGestureMode((active) => !active)}
          aria-label={canvasGestureMode ? 'Return to app interaction' : 'Enable canvas gestures'}
          aria-pressed={canvasGestureMode}
          title={canvasGestureMode ? 'App input is paused so canvas gestures can reach the board' : 'Let this app receive finger and Pencil input'}
          className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${canvasGestureMode ? 'border-indigo-400/30 bg-indigo-400/10 text-indigo-200' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
        >
          <Hand className="h-3.5 w-3.5" />
          {canvasGestureMode ? 'Canvas gestures' : 'Interact'}
        </button>
        <span className="ml-auto truncate text-[10px] text-slate-500" aria-live="polite">
        {networkPermissionError || storageStatus?.message || (storageCount ? `${storageCount} key${storageCount === 1 ? '' : 's'} in workspace` : 'App data not yet confirmed on this device')}
        </span>
        {hasClearUndo && clearedStorageRef.current && (
          <button
            type="button"
            onClick={handleUndoClear}
            aria-label="Undo the latest clear; this replaces current app data"
            title="Undo the latest clear; this replaces current app data"
            className="min-h-[40px] rounded-lg px-2 text-[11px] font-medium text-indigo-300 hover:bg-indigo-400/10"
          >
            Undo clear · replace current
          </button>
        )}
      </div>
      {(pendingExternalLink || navigationBlocked || externalLinkError) && (
        <div data-window-toolbar="app-status" className="flex min-h-[48px] shrink-0 flex-wrap items-center gap-2 border-b border-white/5 bg-slate-950/55 px-3 py-1.5" role="status" aria-live="polite" onPointerDown={stopEventPropagation}>
          {pendingExternalLink ? (
            <>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-200">Open link to <span className="font-mono text-slate-100">{pendingExternalLink.origin}</span>?</span>
              <button type="button" onClick={openPendingExternalLink} className="min-h-[44px] rounded-lg bg-indigo-500 px-3 text-xs font-semibold text-white hover:bg-indigo-400">Open link</button>
              <button type="button" onClick={() => setPendingExternalLink(null)} className="min-h-[44px] rounded-lg px-3 text-xs font-medium text-slate-300 hover:bg-white/10">Dismiss</button>
            </>
          ) : navigationBlocked ? (
            <span className="min-w-0 flex-1 truncate text-xs text-slate-400">This app tried to leave its preview.</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-amber-200">{externalLinkError}</span>
          )}
          {(navigationBlocked || externalLinkError) && <button type="button" onClick={() => { setNavigationBlocked(false); setExternalLinkError(null); }} className="min-h-[44px] rounded-lg px-3 text-xs font-medium text-slate-300 hover:bg-white/10">Dismiss</button>}
        </div>
      )}

      {/* Main Sandbox Canvas / Code Area */}
      <div
        className="relative flex-1 min-h-0 w-full overflow-hidden bg-black/40 select-text overscroll-contain"
        onPointerDown={isSelected && !canvasGestureMode ? smartStopPropagation : undefined}
      >
        {/* The toolbar's Canvas gestures control always remains outside the iframe. */}
        {!isSelected && viewMode === 'preview' && !runtimePaused && (
          <div className="absolute inset-0 z-10 bg-transparent cursor-pointer" />
        )}
        {viewMode === 'preview' ? (
          runtimePaused ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-300">
              <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-200">
                Paused for review
              </span>
              <p className="max-w-md text-sm text-slate-300">
                This app&apos;s source has not run in this canvas. Review it before choosing to run it.
              </p>
              <button
                type="button"
                onPointerDown={beginPointerIntent}
                onPointerMove={updatePointerPosition}
                onPointerLeave={cancelPointerSequence}
                onPointerCancel={cancelPointerSequence}
                onPointerUpCapture={(event) => runPointerIntent(event, reviewSource)}
                onClick={(event) => runClickIntent(event, reviewSource)}
                disabled={!canEditSource()}
                title={!canEditSource() ? 'Unlock this app to review its source' : 'Review source'}
                className="min-h-[44px] rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Review source
              </button>
            </div>
          ) : !storageHydrationReady || !networkPermissionsReady ? (
            <div role="status" aria-live="polite" className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-300">
              {storageHydrationMatches && storageHydration?.status === 'error' ? (
                <>
                  <p className="max-w-md text-sm text-amber-100">
                    {storageStatus?.message || 'App data could not be confirmed on this device.'}
                  </p>
                  {!foreignWorkspaceChangeRef.current && (
                    <button
                      type="button"
                      onClick={runWithoutStorageConfirmation}
                      className="min-h-[44px] rounded-xl border border-amber-200/20 bg-amber-300/10 px-4 text-sm font-medium text-amber-100 hover:bg-amber-300/15"
                    >
                      Run with board-saved data
                    </button>
                  )}
                </>
              ) : (
                <p className="max-w-md text-sm text-slate-300">Loading this app and its saved access choices…</p>
              )}
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              key={key}
              srcDoc={srcDoc}
              sandbox={ARTIFACT_BOUNDARY_SANDBOX}
              title={title}
              className="visionos-artifact-frame canvasos-artifact-frame h-full w-full border-none"
              style={{ pointerEvents: canvasGestureMode ? 'none' : 'auto' }}
            />
          )
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center p-4 text-center text-xs text-slate-400">
            Source editing is open in the unscaled editor.
          </div>
        )}
      </div>
    </HTMLContainer>
    {networkDialogOpen && networkPermissionsReady && networkHydration?.identity && (
      <ArtifactNetworkPermissionsDialog
        requestedOrigins={requestedNetworkOrigins}
        allowedOrigins={activeNetworkOrigins}
        peerConnectionsAllowed={peerConnectionsAllowed}
        peerRequested={peerConnectionRequested}
        appPaused={runtimePaused}
        rememberAvailable={networkHydration.canRemember}
        busy={networkPermissionBusy}
        error={networkPermissionError}
        allowAnywayLabel={showNetworkAllowAnyway
          ? (runtimePaused
            ? 'Allow access anyway'
            : networkChoiceWithoutStorageRef.current?.flush.accepted
              ? 'Allow and reload anyway'
              : 'Discard pending app state and reload')
          : null}
        onClose={() => {
          if (networkPermissionBusy) return;
          setNetworkDialogOpen(false);
          setNetworkPermissionError(null);
          setShowNetworkAllowAnyway(false);
          networkChoiceWithoutStorageRef.current = null;
        }}
        onAllow={(choice) => void applyNetworkChoice(choice)}
        onAllowAnyway={(choice) => void applyNetworkChoice(choice, true)}
        onRevoke={(origin) => void revokeNetworkSite(origin)}
        onRevokePeerConnections={() => void revokePeerConnections()}
      />
    )}
    {viewMode === 'code' && (
      <ShapeFocusLayer
        title={`Edit source code — ${title || 'Interactive App'}`}
        onClose={toggleSourceView}
      >
        <div data-native-editor="source" className="flex h-full min-h-0 flex-col gap-3 bg-slate-950 p-3 sm:p-5">
          {(codeDraft.isDirty || codeDraft.hasConflict || codeDraft.recovered || !codeDraft.recoveryAvailable || runtimePaused) && (
            <div role={codeDraft.hasConflict ? 'alert' : 'status'} className="shrink-0 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2.5 text-sm leading-relaxed text-amber-100">
              {codeDraft.hasConflict
                ? 'Canvas source changed while this draft was open. Save to replace the latest source, or discard to load it.'
                : codeDraft.recovered
                  ? 'Recovered an unsaved source draft from this tab.'
                  : !codeDraft.recoveryAvailable
                    ? 'Browser recovery cannot keep this source draft. Save before closing the editor.'
                    : runtimePaused
                      ? 'Review this source before choosing Run app.'
                      : 'Unsaved source changes.'}
            </div>
          )}
          <label className="flex min-h-0 flex-1 flex-col gap-2 text-sm font-medium text-slate-200">
            App source
            <textarea
              value={codeDraft.value}
              data-scrollable="true"
              onChange={(event) => codeDraft.setValue(event.target.value)}
              onPointerDown={stopEventPropagation}
              spellCheck={false}
              className="min-h-0 w-full flex-1 resize-none rounded-xl border border-white/15 bg-black/45 p-3 font-mono text-sm leading-relaxed text-indigo-100 outline-none focus:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-300/70"
            />
          </label>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
            <span className="min-w-0 flex-1 text-xs text-slate-400" role="status">
              {runtimePaused ? 'Paused app source' : storageStatus?.message || 'Source draft is kept in this browser until saved.'}
            </span>
            <div className="flex flex-wrap justify-end gap-2">
              {codeDraft.isDirty && <button type="button" onClick={codeDraft.discard} className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-slate-200 hover:bg-white/10">Discard draft</button>}
              {runtimePaused && !codeDraft.isDirty && <button type="button" onPointerDown={beginPointerIntent} onPointerMove={updatePointerPosition} onPointerLeave={cancelPointerSequence} onPointerCancel={cancelPointerSequence} onPointerUpCapture={(event) => runPointerIntent(event, runPausedApp)} disabled={!canEditSource()} onClick={(event) => runClickIntent(event, runPausedApp)} title={!canEditSource() ? 'Unlock this app to run it' : 'Run app'} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-500/15 px-4 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"><Play className="h-4 w-4" />Run app</button>}
              <button type="button" disabled={!codeDraft.isDirty || !canEditSource()} onClick={saveSourceDraft} className="flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-4 w-4" />Save source</button>
            </div>
          </div>
        </div>
      </ShapeFocusLayer>
    )}
    </>
  );
}

export class ArtifactShapeUtil extends BaseBoxShapeUtil<TLArtifactShape> {
  static override type = 'artifact' as const;
  static override props = artifactShapeProps;

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override canScroll() {
    return true;
  }

  override onResize(
    shape: TLArtifactShape,
    info: TLResizeInfo<TLArtifactShape>
  ) {
    return {
      props: {
        w: Math.max(480, Math.round(shape.props.w * info.scaleX)),
        h: Math.max(360, Math.round(shape.props.h * info.scaleY)),
      },
    };
  }

  override getDefaultProps(): TLArtifactShape['props'] {
    return {
      w: 760,
      h: 520,
      title: 'Particle Gravity Physics Sandbox',
      code: `<canvas id="c"></canvas>
<script>
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  function resize(){ c.width = window.innerWidth; c.height = window.innerHeight; }
  window.onresize = resize; resize();
  
  const particles = [];
  for(let i = 0; i < 45; i++) {
    particles.push({
      x: Math.random() * c.width,
      y: Math.random() * c.height,
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3,
      radius: Math.random() * 4 + 2,
      color: "hsl(" + (Math.random() * 60 + 220) + ", 85%, 65%)"
    });
  }

  let mouse = { x: -1000, y: -1000 };
  window.onmousemove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };

  function loop() {
    ctx.fillStyle = "rgba(11, 14, 28, 0.25)";
    ctx.fillRect(0, 0, c.width, c.height);

    for(let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if(p.x < 0 || p.x > c.width) p.vx *= -1;
      if(p.y < 0 || p.y > c.height) p.vy *= -1;

      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if(dist < 120 && dist > 0) {
        p.vx -= (dx / dist) * 0.4;
        p.vy -= (dy / dist) * 0.4;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      for(let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const d2 = Math.hypot(p.x - p2.x, p.y - p2.y);
        if(d2 < 90) {
          ctx.strokeStyle = "rgba(129, 140, 248, " + (1 - d2/90)*0.4 + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(loop);
  }
  loop();
</script>`,
      color: 'light-violet',
      storage: {},
      networkEnabled: false,
      runtimePaused: false,
    };
  }

  override component(shape: TLArtifactShape) {
    return (
      <ArtifactComponent
        shape={shape}
        editor={this.editor}
        onUpdate={(updates) => {
          this.editor.run(
            () =>
              this.editor.updateShape({
                id: shape.id,
                type: 'artifact',
                props: updates,
              }),
            {
              history: Object.keys(updates).every((k) => k === 'storage')
                ? 'ignore'
                : 'record',
            }
          );
        }}
      />
    );
  }

  override indicator(shape: TLArtifactShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />
    );
  }
}
