import type { NextRequest } from 'next/server';
import type { AIProvider } from '@/types/spatial';
export function providerKeys(
  req: NextRequest,
  body: any,
  provider: AIProvider
): string[] {
  const values =
    provider === 'openrouter'
      ? [
          body.openRouterApiKey,
          body.openRouterApiKeys,
          req.headers.get('x-openrouter-api-key'),
          req.headers.get('x-openrouter-api-keys'),
          process.env.OPENROUTER_API_KEY,
          process.env.OPENROUTER_API_KEYS,
        ]
      : [
          body.apiKey,
          body.apiKeys,
          req.headers.get('x-gemini-api-key'),
          req.headers.get('x-gemini-api-keys'),
          process.env.GEMINI_API_KEY ||
            process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
            process.env.GOOGLE_API_KEY,
          process.env.GEMINI_API_KEYS,
        ];
  return [
    ...new Set(
      values
        .flatMap((v) => {
          if (Array.isArray(v)) return v;
          if (typeof v !== 'string') return [];
          try {
            const a = JSON.parse(v);
            if (Array.isArray(a)) return a;
          } catch {}
          return v.split(/[\n,;]+/);
        })
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => /^[\x21-\x7e]{8,512}$/.test(v))
    ),
  ].slice(0, 5);
}
/** Correct across split UTF-8, CRLF, multiple data lines and an unterminated final event. */
export async function* readSSE(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  function parse() {
    const text = data.join('\n');
    data = [];
    return text && text !== '[DONE]' ? JSON.parse(text) : null;
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length > 2000000)
        throw new Error('Provider event is too large.');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (!line) {
          const event = parse();
          if (event) yield event;
        } else if (line.startsWith('data:'))
          data.push(line.slice(5).trimStart());
      }
      if (done) break;
    }
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).trim());
    const event = parse();
    if (event) yield event;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
