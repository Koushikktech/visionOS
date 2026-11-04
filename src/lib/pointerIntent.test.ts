import { describe, expect, test } from 'bun:test';
import {
  cancelPointerIntent,
  matchesPrimaryPointerIntent,
  startPrimaryPointerIntent,
  updatePointerIntent,
} from './pointerIntent';

const pointer = (overrides: Partial<{ pointerId: number; button: number; isPrimary: boolean; clientX: number; clientY: number }> = {}) => ({
  pointerId: 1,
  button: 0,
  isPrimary: true,
  clientX: 20,
  clientY: 30,
  ...overrides,
});

describe('primary pointer action intent', () => {
  test('requires a matching primary left-button press and release', () => {
    const intent = startPrimaryPointerIntent(pointer());
    expect(matchesPrimaryPointerIntent(intent, pointer())).toBe(true);
    expect(matchesPrimaryPointerIntent(intent, pointer({ pointerId: 2 }))).toBe(false);
    expect(matchesPrimaryPointerIntent(intent, pointer({ button: 2 }))).toBe(false);
    expect(matchesPrimaryPointerIntent(intent, pointer({ isPrimary: false }))).toBe(false);
  });

  test('does not treat a secondary-button press as an action intent', () => {
    expect(startPrimaryPointerIntent(pointer({ button: 2 }))).toBeNull();
    expect(startPrimaryPointerIntent(pointer({ isPrimary: false }))).toBeNull();
  });

  test('cancels a pointer that moves beyond the click threshold', () => {
    const intent = startPrimaryPointerIntent(pointer());
    const moved = updatePointerIntent(intent, pointer({ clientX: 29 }));
    expect(matchesPrimaryPointerIntent(moved, pointer({ clientX: 20 }))).toBe(false);
  });

  test('cancels a pointer that leaves the action control or is cancelled by the browser', () => {
    const intent = startPrimaryPointerIntent(pointer());
    const leftControl = cancelPointerIntent(intent, 1);
    expect(matchesPrimaryPointerIntent(leftControl, pointer())).toBe(false);
    expect(cancelPointerIntent(intent, 2)).toEqual(intent);
  });
});
