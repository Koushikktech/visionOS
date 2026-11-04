'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor, TLEditorSnapshot } from '@tldraw/tldraw';
import {
  createBoardRecoveryController,
  type BoardRecoveryController,
  type BoardRecoveryState,
} from '../lib/boardRecoveryPersistence';

const INITIAL_STATE: BoardRecoveryState = {
  status: 'checking',
  pendingChanges: 0,
  hasUncommittedChanges: false,
};

/** Binds the app-owned board recovery controller to the mounted tldraw editor. */
export function useBoardRecovery(editor: Editor | null) {
  const [state, setState] = useState<BoardRecoveryState>(INITIAL_STATE);
  const controllerRef = useRef<BoardRecoveryController | null>(null);

  useEffect(() => {
    if (!editor) {
      setState(INITIAL_STATE);
      return;
    }

    const controller = createBoardRecoveryController(editor);
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setState);

    return () => {
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [editor]);

  const keepCurrent = useCallback((
    expectedRevision: number,
    expectedLiveRevision: number,
    expectedLiveSnapshot: TLEditorSnapshot
  ) => {
    const controller = controllerRef.current;
    if (!controller) return Promise.reject(new Error('The canvas is not ready yet.'));
    return controller.keepCurrent(expectedRevision, expectedLiveRevision, expectedLiveSnapshot);
  }, []);

  const restoreRecovery = useCallback((
    expectedRevision: number,
    expectedLiveRevision: number,
    expectedLiveSnapshot: TLEditorSnapshot
  ) => {
    const controller = controllerRef.current;
    if (!controller) return Promise.reject(new Error('The canvas is not ready yet.'));
    return controller.restoreRecovery(expectedRevision, expectedLiveRevision, expectedLiveSnapshot);
  }, []);

  return { ...state, keepCurrent, restoreRecovery };
}
