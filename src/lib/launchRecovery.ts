export type CanvasLaunchStatus = 'loading' | 'slow' | 'failed';

export function getCanvasLaunchStatus(input: {
  isLoading?: boolean;
  timedOut?: boolean;
  error?: unknown;
}): CanvasLaunchStatus {
  if (input.error) return 'failed';
  if (input.isLoading && input.timedOut) return 'slow';
  return 'loading';
}
