/** Track which coalesced app-storage mutation has a committed sidecar ack. */
export function createArtifactStorageAcknowledgementTracker() {
  let pendingRevision = 0;
  let confirmedRevision = 0;

  return {
    markPending() {
      pendingRevision += 1;
      return pendingRevision;
    },
    currentRevision() {
      return pendingRevision;
    },
    isCurrent(revision: number) {
      return revision === pendingRevision;
    },
    needsConfirmation(hasQueuedSnapshot: boolean) {
      return pendingRevision > confirmedRevision && !hasQueuedSnapshot;
    },
    confirm(revision: number) {
      if (Number.isSafeInteger(revision) && revision >= 0 && revision <= pendingRevision) {
        confirmedRevision = Math.max(confirmedRevision, revision);
      }
    },
    reset() {
      pendingRevision = 0;
      confirmedRevision = 0;
    },
  };
}
