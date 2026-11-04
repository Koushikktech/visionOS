import type { Editor } from '@tldraw/tldraw';

export interface EditorOperationRollbackStatus {
  attempted: boolean;
  error?: unknown;
}

/**
 * Run an editor operation without sending its expected failure through
 * tldraw's top-level HistoryManager.batch error handler. That handler marks
 * the editor as potentially corrupted before callers can roll back.
 *
 * The operation still runs in an editor transaction. When supplied, the
 * rollback mark is applied inside that transaction; the original error is
 * rethrown only after the run returns, without triggering the fatal fallback.
 */
export function runEditorOperationSafely(
  editor: Editor | null,
  operation: () => void,
  rollbackMark?: string,
  rollbackStatus?: EditorOperationRollbackStatus
) {
  if (!editor) {
    operation();
    return;
  }

  let didThrow = false;
  let operationError: unknown;
  editor.run(() => {
    try {
      operation();
    } catch (error) {
      didThrow = true;
      operationError = error;
      if (rollbackMark && rollbackStatus) {
        rollbackStatus.attempted = true;
        try {
          editor.bailToMark(rollbackMark);
        } catch (rollbackError) {
          rollbackStatus.error = rollbackError;
        }
      }
    }
  });
  if (didThrow) throw operationError;
}
