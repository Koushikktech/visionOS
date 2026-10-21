/** Opaque sandbox origins report "null"; bind trust to the iframe window instead. */
export function readStorageMessage(
  data: unknown,
  source: unknown,
  expectedSource: unknown,
  id: string
): Record<string, string> | null {
  if (
    !expectedSource ||
    source !== expectedSource ||
    !data ||
    typeof data !== 'object'
  )
    return null;
  const message = data as Record<string, unknown>;
  if (
    message.type !== 'CANVASOS_STORAGE_SYNC' ||
    message.shapeId !== id ||
    !message.storage ||
    typeof message.storage !== 'object' ||
    Array.isArray(message.storage)
  )
    return null;
  const entries = Object.entries(message.storage);
  if (
    entries.length > 500 ||
    entries.some(
      ([key, value]) => key.length > 512 || typeof value !== 'string'
    ) ||
    JSON.stringify(message.storage).length > 1000000
  )
    return null;
  return Object.fromEntries(entries) as Record<string, string>;
}
