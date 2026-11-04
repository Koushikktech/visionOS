import { describe, expect, it } from 'bun:test';
import {
  ARTIFACT_NETWORK_PERMISSION_LIMITS,
  clearArtifactNetworkGrantsForApp,
  createArtifactNetworkGrantIdentity,
  grantArtifactNetworkSessionSites,
  forgetArtifactNetworkGrant,
  readArtifactNetworkSessionGrants,
  readArtifactNetworkSessionPermissions,
  readArtifactNetworkGrants,
  rememberArtifactNetworkGrant,
  rememberArtifactNetworkChoices,
  rememberArtifactNetworkGrants,
  setArtifactNetworkPeerConnections,
  grantArtifactNetworkSessionPeerConnections,
  forgetArtifactNetworkSessionPeerConnections,
} from './artifactNetworkPermissions';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  setRaw(value: string) { this.values.set('visionos_artifact_network_grants_v1', value); }
  get serialized() { return this.values.get('visionos_artifact_network_grants_v1') ?? null; }
}

const identity = {
  workspaceKey: 'workspace:local',
  epoch: 4,
  shapeId: 'shape:app',
  sourceFingerprint: 'a'.repeat(64),
};

describe('artifact network permission grants', () => {
  it('persists grants only for the exact workspace, epoch, shape, and source fingerprint', async () => {
    const storage = new MemoryStorage();
    const created = await createArtifactNetworkGrantIdentity({
      workspaceKey: identity.workspaceKey,
      epoch: identity.epoch,
      shapeId: identity.shapeId,
      source: '<html><script>secret source</script></html>',
    });
    expect(created).not.toBeNull();
    expect(created).not.toHaveProperty('source');
    expect(created?.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);

    expect(await rememberArtifactNetworkGrant(identity, 'https://api.example.test', storage))
      .toEqual({ status: 'saved' });
    expect(await rememberArtifactNetworkGrant(identity, 'https://api.example.test/path', storage))
      .toEqual({ status: 'invalid' });
    expect(await rememberArtifactNetworkGrant(identity, 'https://api.example.test', storage))
      .toEqual({ status: 'already-saved' });
    expect(readArtifactNetworkGrants(identity, storage)).toEqual({
      status: 'available',
      origins: ['https://api.example.test'],
      peerConnections: false,
    });
    expect(readArtifactNetworkGrants({ ...identity, epoch: 5 }, storage)).toEqual({ status: 'available', origins: [], peerConnections: false });
    expect(readArtifactNetworkGrants({ ...identity, shapeId: 'shape:other' }, storage)).toEqual({ status: 'available', origins: [], peerConnections: false });
    expect(readArtifactNetworkGrants({ ...identity, sourceFingerprint: 'b'.repeat(64) }, storage)).toEqual({ status: 'available', origins: [], peerConnections: false });
  });

  it('removes one grant and deletes an empty app record', async () => {
    const storage = new MemoryStorage();
    expect((await rememberArtifactNetworkGrant(identity, 'https://one.example.test', storage)).status).toBe('saved');
    expect((await rememberArtifactNetworkGrant(identity, 'https://two.example.test', storage)).status).toBe('saved');
    expect((await forgetArtifactNetworkGrant(identity, 'https://one.example.test', storage)).status).toBe('removed');
    expect(readArtifactNetworkGrants(identity, storage)).toEqual({ status: 'available', origins: ['https://two.example.test'], peerConnections: false });
    expect((await forgetArtifactNetworkGrant(identity, 'https://two.example.test', storage)).status).toBe('removed');
    expect(readArtifactNetworkGrants(identity, storage)).toEqual({ status: 'available', origins: [], peerConnections: false });
    expect(storage.serialized).toBeNull();
  });

  it('can clear older source versions after a committed app source edit', async () => {
    const storage = new MemoryStorage();
    const olderSource = identity;
    const currentSource = { ...identity, sourceFingerprint: 'b'.repeat(64) };
    const anotherApp = { ...identity, shapeId: 'shape:other' };
    expect((await rememberArtifactNetworkGrant(olderSource, 'https://old.example.test', storage)).status).toBe('saved');
    expect((await rememberArtifactNetworkGrant(currentSource, 'https://current.example.test', storage)).status).toBe('saved');
    expect((await rememberArtifactNetworkGrant(anotherApp, 'https://other.example.test', storage)).status).toBe('saved');

    expect(await clearArtifactNetworkGrantsForApp(identity, storage)).toEqual({ status: 'removed' });
    expect(readArtifactNetworkGrants(olderSource, storage)).toEqual({ status: 'available', origins: [], peerConnections: false });
    expect(readArtifactNetworkGrants(currentSource, storage)).toEqual({ status: 'available', origins: [], peerConnections: false });
    expect(readArtifactNetworkGrants(anotherApp, storage)).toEqual({
      status: 'available',
      origins: ['https://other.example.test'],
      peerConnections: false,
    });
  });

  it('fails closed when local storage is unavailable, malformed, oversized, or throws', async () => {
    expect(readArtifactNetworkGrants(identity, null)).toEqual({ status: 'unavailable' });
    expect(await rememberArtifactNetworkGrant(identity, 'https://api.example.test', null)).toEqual({ status: 'unavailable' });

    const malformed = new MemoryStorage();
    malformed.setRaw(JSON.stringify({ version: 1, apps: [{ networkEnabled: true }] }));
    expect(readArtifactNetworkGrants(identity, malformed)).toEqual({ status: 'invalid' });
    expect(await rememberArtifactNetworkGrant(identity, 'https://api.example.test', malformed)).toEqual({ status: 'invalid' });

    const oversized = new MemoryStorage();
    oversized.setRaw(' '.repeat(ARTIFACT_NETWORK_PERMISSION_LIMITS.maxSerializedBytes + 1));
    expect(readArtifactNetworkGrants(identity, oversized)).toEqual({ status: 'invalid' });

    const throwing = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(readArtifactNetworkGrants(identity, throwing)).toEqual({ status: 'unavailable' });
    expect(await rememberArtifactNetworkGrant(identity, 'https://api.example.test', throwing))
      .toEqual({ status: 'unavailable' });
  });

  it('bounds app and origin counts without evicting existing grants', async () => {
    const storage = new MemoryStorage();
    const origins = Array.from({ length: 25 }, (_, index) => `https://site-${index}.example.test`);
    for (const origin of origins.slice(0, 24)) {
      expect((await rememberArtifactNetworkGrant(identity, origin, storage)).status).toBe('saved');
    }
    expect(await rememberArtifactNetworkGrant(identity, origins[24], storage)).toEqual({ status: 'limit' });
    expect(readArtifactNetworkGrants(identity, storage)).toEqual({
      status: 'available',
      origins: origins.slice(0, 24),
      peerConnections: false,
    });

    for (let index = 0; index < ARTIFACT_NETWORK_PERMISSION_LIMITS.maxApps - 1; index++) {
      const other = { ...identity, shapeId: `shape:${index}` };
      expect((await rememberArtifactNetworkGrant(other, `https://site-${index}.example.test`, storage)).status).toBe('saved');
    }
    expect(await rememberArtifactNetworkGrant({ ...identity, shapeId: 'shape:last' }, 'https://last.example.test', storage))
      .toEqual({ status: 'limit' });
    expect(readArtifactNetworkGrants(identity, storage).status).toBe('available');
  });

  it('rejects invalid identities and origins rather than broadening authority', async () => {
    const storage = new MemoryStorage();
    expect(readArtifactNetworkGrants({ ...identity, sourceFingerprint: 'not-a-hash' }, storage))
      .toEqual({ status: 'invalid' });
    for (const origin of ['http://api.example.test', 'https://*.example.test', 'https://api.example.test/path']) {
      expect(await rememberArtifactNetworkGrant(identity, origin, storage)).toEqual({ status: 'invalid' });
    }
    expect(storage.serialized).toBeNull();
  });

  it('stores only explicitly granted session sites in module memory', async () => {
    const storage = new MemoryStorage();
    expect(await rememberArtifactNetworkGrants(identity, ['https://remember.example.test'], storage)).toEqual({ status: 'saved' });
    expect(grantArtifactNetworkSessionSites(identity, ['https://session.example.test', 'https://session.example.test']))
      .toEqual({ status: 'saved' });
    expect(readArtifactNetworkSessionGrants(identity)).toEqual(['https://session.example.test']);
    expect(readArtifactNetworkGrants(identity, storage)).toEqual({
      status: 'available',
      origins: ['https://remember.example.test'],
      peerConnections: false,
    });
  });

  it('stores peer API consent separately and removes it without dropping site consent', async () => {
    const storage = new MemoryStorage();
    expect(await rememberArtifactNetworkChoices(identity, {
      origins: ['https://api.example.test'],
      peerConnections: true,
    }, storage)).toEqual({ status: 'saved' });
    expect(readArtifactNetworkGrants(identity, storage)).toEqual({
      status: 'available',
      origins: ['https://api.example.test'],
      peerConnections: true,
    });
    expect(await setArtifactNetworkPeerConnections(identity, false, storage)).toEqual({ status: 'saved' });
    expect(readArtifactNetworkGrants(identity, storage)).toEqual({
      status: 'available',
      origins: ['https://api.example.test'],
      peerConnections: false,
    });
  });

  it('keeps session peer API choices in host memory and revokes them independently', () => {
    const sessionIdentity = { ...identity, shapeId: 'shape:peer-session' };
    expect(grantArtifactNetworkSessionPeerConnections(sessionIdentity)).toEqual({ status: 'saved' });
    expect(readArtifactNetworkSessionPermissions(sessionIdentity)).toEqual({ origins: [], peerConnections: true });
    expect(forgetArtifactNetworkSessionPeerConnections(sessionIdentity)).toEqual({ status: 'removed' });
    expect(readArtifactNetworkSessionPermissions(sessionIdentity)).toEqual({ origins: [], peerConnections: false });
  });
});
