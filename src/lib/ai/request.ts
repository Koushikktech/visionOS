import type { NextRequest } from 'next/server';
const windows = new Map<string, { count: number; until: number }>();
/** Defense in depth for a private MVP. Shared/public hosting still requires gateway auth/quotas. */
export function guardRequest(req: NextRequest): Response | null {
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (
        new URL(origin).host !== (req.headers.get('host') || req.nextUrl.host)
      )
        return Response.json(
          { error: 'Cross-origin AI requests are not allowed.' },
          { status: 403 }
        );
    } catch {
      return Response.json(
        { error: 'Invalid request origin.' },
        { status: 400 }
      );
    }
  }
  if (Number(req.headers.get('content-length') || 0) > 8_000_000)
    return Response.json({ error: 'Request too large.' }, { status: 413 });
  const id = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
  const now = Date.now();
  if (windows.size > 2000)
    for (const [key, w] of windows) if (w.until < now) windows.delete(key);
  const w = windows.get(id);
  if (w && w.until > now && w.count >= 20)
    return Response.json(
      { error: 'Too many AI requests. Please wait a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  windows.set(
    id,
    w && w.until > now
      ? { ...w, count: w.count + 1 }
      : { count: 1, until: now + 60000 }
  );
  return null;
}
export function providerSignal(req: NextRequest) {
  const controller = new AbortController();
  const abort = () => controller.abort(req.signal.reason);
  if (req.signal.aborted) {
    abort();
    return controller.signal;
  }
  req.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('Provider timed out.')),
    150000
  );
  // Node timer must not keep the server alive after shutdown.
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      req.signal.removeEventListener('abort', abort);
    },
    { once: true }
  );
  return controller.signal;
}
export function validateChatRequest(body: any): void {
  if (
    !body ||
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > 60 ||
    body.messages.some(
      (m: any) =>
        !m ||
        !['user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string' ||
        m.content.length > 60000
    )
  )
    throw new Error('Invalid conversation. Send a shorter request.');
  if (
    !body.culledContext ||
    !Array.isArray(body.culledContext.selectedNodes) ||
    !Array.isArray(body.culledContext.viewportNeighbors)
  )
    throw new Error('Canvas context is required.');
  if (JSON.stringify(body.culledContext).length > 350000)
    throw new Error('Canvas context is too large. Select fewer objects.');
  if (JSON.stringify(body).length > 8_000_000)
    throw new Error('Request too large.');
  if (body.provider && !['gemini', 'openrouter'].includes(body.provider))
    throw new Error('Unsupported provider.');
  if (
    body.model &&
    (typeof body.model !== 'string' || !/^[\w./:-]{1,160}$/.test(body.model))
  )
    throw new Error('Invalid model identifier.');
}
