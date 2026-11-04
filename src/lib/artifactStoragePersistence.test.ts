import { describe, expect, it } from 'bun:test';
import {
  artifactSourceFingerprint,
  createArtifactStorageOperationGate,
} from './artifactStoragePersistence';

describe('artifact storage durability coordination', () => {
  it('uses a collision-resistant exact-source fingerprint without storing the source', async () => {
    expect(await artifactSourceFingerprint('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(await artifactSourceFingerprint('abc')).toBe(await artifactSourceFingerprint('abc'));
    expect(await artifactSourceFingerprint('abcd')).not.toBe(await artifactSourceFingerprint('abc'));
  });

  it('drains active writes and holds queued writes until restore releases the workspace', async () => {
    const gate = createArtifactStorageOperationGate();
    const order: string[] = [];
    let enterFirst!: () => void;
    let finishFirst!: () => void;
    const entered = new Promise<void>((resolve) => { enterFirst = resolve; });
    const held = new Promise<void>((resolve) => { finishFirst = resolve; });

    const first = gate.run('workspace', 'shape:app', async () => {
      order.push('first-start');
      enterFirst();
      await held;
      order.push('first-finished');
    });
    await entered;
    const restore = gate.beginRestore('workspace');
    const drained = restore.waitForIdle();
    const queued = gate.run('workspace', 'shape:app', async () => {
      order.push('queued-write');
    });

    finishFirst();
    await drained;
    expect(order).toEqual(['first-start', 'first-finished']);
    restore.release();
    await Promise.all([first, queued]);
    expect(order).toEqual(['first-start', 'first-finished', 'queued-write']);
  });

  it('cancels queued initialization after its owning app becomes stale', async () => {
    const gate = createArtifactStorageOperationGate();
    const restore = gate.beginRestore('workspace');
    let current = true;
    let started = false;
    const queued = gate.run('workspace', 'shape:app', async () => {
      started = true;
    }, () => current);
    current = false;
    restore.release();
    expect(await queued).toBeUndefined();
    expect(started).toBe(false);
  });
});
