import { describe, expect, it } from 'bun:test';
import { createArtifactStorageAcknowledgementTracker } from './artifactStorageAcknowledgement';

describe('artifact storage acknowledgement tracking', () => {
  it('keeps a net-zero mutation burst pending until a durable ack arrives', () => {
    const tracker = createArtifactStorageAcknowledgementTracker();
    const revision = tracker.markPending();

    expect(tracker.needsConfirmation(false)).toBe(true);
    expect(tracker.needsConfirmation(true)).toBe(false);
    tracker.confirm(revision);
    expect(tracker.needsConfirmation(false)).toBe(false);
  });

  it('does not let an older transaction ack settle a newer mutation', () => {
    const tracker = createArtifactStorageAcknowledgementTracker();
    const first = tracker.markPending();
    const second = tracker.markPending();

    expect(tracker.isCurrent(first)).toBe(false);
    tracker.confirm(first);
    expect(tracker.needsConfirmation(false)).toBe(true);
    tracker.confirm(second);
    expect(tracker.needsConfirmation(false)).toBe(false);
  });

  it('resets pending state when a new source or workspace session begins', () => {
    const tracker = createArtifactStorageAcknowledgementTracker();
    tracker.markPending();
    tracker.reset();

    expect(tracker.currentRevision()).toBe(0);
    expect(tracker.needsConfirmation(false)).toBe(false);
  });
});
