import { describe, expect, it } from 'bun:test';
import { getCanvasLaunchStatus } from './launchRecovery';

describe('canvas launch recovery status', () => {
  it('keeps the initial state as loading', () => {
    expect(getCanvasLaunchStatus({ isLoading: true })).toBe('loading');
  });

  it('offers recovery after a long-running load without treating it as a failure', () => {
    expect(getCanvasLaunchStatus({ isLoading: true, timedOut: true })).toBe('slow');
  });

  it('prioritizes a rejected client chunk over the loading timeout', () => {
    expect(getCanvasLaunchStatus({ isLoading: true, timedOut: true, error: new Error('secret') })).toBe(
      'failed'
    );
  });
});
