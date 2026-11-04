export type PointerIntentEvent = {
  pointerId: number;
  button: number;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
};

export type PrimaryPointerIntent = {
  pointerId: number;
  clientX: number;
  clientY: number;
  moved: boolean;
  cancelled: boolean;
};

export const POINTER_INTENT_MOVE_THRESHOLD = 8;

export function startPrimaryPointerIntent(event: PointerIntentEvent): PrimaryPointerIntent | null {
  if (!event.isPrimary || event.button !== 0 || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
  return {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    moved: false,
    cancelled: false,
  };
}

export function updatePointerIntent(
  intent: PrimaryPointerIntent | null,
  event: PointerIntentEvent,
  threshold = POINTER_INTENT_MOVE_THRESHOLD
): PrimaryPointerIntent | null {
  if (!intent || intent.pointerId !== event.pointerId || intent.moved || intent.cancelled) return intent;
  if (Math.hypot(event.clientX - intent.clientX, event.clientY - intent.clientY) > threshold) {
    return { ...intent, moved: true };
  }
  return intent;
}

export function cancelPointerIntent(
  intent: PrimaryPointerIntent | null,
  pointerId: number
): PrimaryPointerIntent | null {
  return intent && intent.pointerId === pointerId ? { ...intent, cancelled: true } : intent;
}

export function matchesPrimaryPointerIntent(
  intent: PrimaryPointerIntent | null,
  event: PointerIntentEvent,
  threshold = POINTER_INTENT_MOVE_THRESHOLD
): boolean {
  return Boolean(
    intent &&
    !intent.moved &&
    !intent.cancelled &&
    event.isPrimary &&
    event.button === 0 &&
    event.pointerId === intent.pointerId &&
    Number.isFinite(event.clientX) &&
    Number.isFinite(event.clientY) &&
    Math.hypot(event.clientX - intent.clientX, event.clientY - intent.clientY) <= threshold
  );
}
