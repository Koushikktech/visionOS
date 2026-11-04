import type { NextRequest } from 'next/server';
import type { AIProvider } from '@/types/spatial';

export function cleanHeaderValue(val?: string | null): string {
  if (!val) return '';
  return val.replace(/[^\x20-\x7E]/g, '').trim();
}

/**
 * Returns prioritized model candidate chain.
 * If the user's primary selection (e.g. 'gemini-3.8-flash') returns 404 or unsupported
 * on their specific account/region, automatically fails over to active Gemini models.
 */
export function getGeminiModelCandidateChain(requestedModel?: string | null): string[] {
  const cleaned = cleanHeaderValue(requestedModel);
  const primary =
    !cleaned || cleaned === 'gemini' || cleaned === 'default'
      ? process.env.GEMINI_MODEL || 'gemini-3.8-flash'
      : cleaned;

  const candidates: string[] = [primary];

  if (primary === 'gemini-3.8-flash') {
    candidates.push('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash');
  } else if (primary === 'gemini-3.5-flash-lite') {
    candidates.push('gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-8b', 'gemini-1.5-flash');
  } else if (primary === 'gemini-4-argon') {
    candidates.push('gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro');
  } else if (primary === 'gemini-2.5-flash') {
    candidates.push('gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-pro');
  } else {
    candidates.push('gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash');
  }

  return Array.from(new Set(candidates));
}

/**
 * Conservative fallback policy for normal chat and Make Real requests.
 * Keep the legacy chain above intact for Swarm, which has its own behavior.
 * A fallback may move only to a known model in the same pricing/performance
 * family; unknown IDs are sent exactly as requested.
 */
export function getNormalGeminiModelCandidateChain(
  requestedModel?: string | null
): string[] {
  const cleaned = cleanHeaderValue(requestedModel);
  const configured = cleanHeaderValue(process.env.GEMINI_MODEL);
  const primary =
    !cleaned || cleaned === 'gemini' || cleaned === 'default'
      ? !configured || configured === 'gemini' || configured === 'default'
        ? 'gemini-3.8-flash'
        : configured
      : cleaned;

  switch (primary) {
    case 'gemini-3.8-flash':
      return [primary, 'gemini-3.6-flash'];
    case 'gemini-3.5-flash-lite':
      return [primary, 'gemini-3.1-flash-lite'];
    default:
      return [primary];
  }
}

type GeminiProviderError = {
  code?: number;
  status?: string;
  message?: string;
};

function structuredGeminiError(bodyText: string): GeminiProviderError | null {
  try {
    const parsed = JSON.parse(bodyText);
    const error = parsed?.error;
    if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
    return {
      code: typeof error.code === 'number' ? error.code : undefined,
      status: typeof error.status === 'string' ? error.status : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    };
  } catch {
    return null;
  }
}

/** Only a structured model-availability response can advance the normal chain. */
export function isGeminiModelUnavailable(
  httpStatus: number,
  bodyText: string
): boolean {
  const error = structuredGeminiError(bodyText);
  if (!error?.message) return false;
  const message = error.message.toLowerCase();
  const availabilityFailure =
    /\b(not found|does not exist|not supported|unsupported|no such model)\b/.test(
      message
    );
  const mentionsModel = /\bmodel(?:s)?\b/.test(message);
  const isNotFound =
    httpStatus === 404 &&
    (error.status === 'NOT_FOUND' || error.code === 404);
  const isInvalidModel =
    httpStatus === 400 &&
    (error.status === 'INVALID_ARGUMENT' || error.code === 400);
  return (isNotFound || isInvalidModel) && availabilityFailure && mentionsModel;
}

/** Retry without thinking settings only for a structured unsupported-field error. */
export function isGeminiThinkingSettingUnsupported(
  httpStatus: number,
  bodyText: string
): boolean {
  if (httpStatus !== 400) return false;
  const error = structuredGeminiError(bodyText);
  if (
    !error?.message ||
    (error.status !== 'INVALID_ARGUMENT' && error.code !== 400)
  )
    return false;
  const message = error.message.toLowerCase();
  const namesThinkingSetting =
    /thinkingconfig|thinkingbudget|includethoughts|thinking budget/.test(
      message
    );
  const rejectsSetting =
    /unknown|unrecognized|unsupported|not supported|cannot find|no field|invalid field/.test(
      message
    );
  return namesThinkingSetting && rejectsSetting;
}

/** Read only a bounded prefix of a provider error response for structured checks. */
export async function readProviderErrorText(
  response: Response,
  maxBytes = 32_768
): Promise<string> {
  if (!response.body || maxBytes <= 0) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      const remaining = maxBytes - totalBytes;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      totalBytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength) {
        void reader.cancel().catch(() => {});
        break;
      }
    }
    if (totalBytes >= maxBytes) void reader.cancel().catch(() => {});
  } finally {
    reader.releaseLock();
  }
  return text;
}

export class ProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderResponseError';
  }
}

/** Read a bounded JSON result without forwarding provider parse/read errors. */
export async function readProviderJson<T = unknown>(
  response: Response,
  maxBytes = 8_000_000
): Promise<T> {
  if (!response.body)
    throw new ProviderResponseError('The provider returned an empty response. Please retry.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ProviderResponseError('The provider response is too large. Try a smaller request.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderResponseError) throw error;
    throw new ProviderResponseError('Could not read the provider response. Please retry.');
  } finally {
    reader.releaseLock();
  }

  try {
    let text = '';
    for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
    text += decoder.decode();
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderResponseError('The provider returned an invalid response. Please retry.');
  }
}

export function providerKeys(
  req: NextRequest,
  body: any,
  provider: AIProvider
): string[] {
  const requestValues =
    provider === 'openrouter'
      ? [
          body.openRouterApiKey,
          body.openRouterApiKeys,
          req.headers.get('x-openrouter-api-key'),
          req.headers.get('x-openrouter-api-keys'),
        ]
      : provider === 'openai'
        ? [
            body.openaiApiKey,
            body.openaiApiKeys,
            req.headers.get('x-openai-api-key'),
            req.headers.get('x-openai-api-keys'),
          ]
        : [
            body.apiKey,
            body.apiKeys,
            req.headers.get('x-gemini-api-key'),
            req.headers.get('x-gemini-api-keys'),
          ];
  const hasRequestKey = requestValues.some((value) =>
    Array.isArray(value)
      ? value.length > 0
      : typeof value === 'string' && value.trim().length > 0
  );
  // Deployed test instances are BYOK-only. A local operator can explicitly opt
  // into a server-funded development setup, but production never reads env keys.
  const allowDevelopmentServerKeys =
    process.env.NODE_ENV !== 'production' &&
    process.env.ALLOW_SERVER_AI_KEYS === 'true';
  const values = hasRequestKey
    ? requestValues
    : allowDevelopmentServerKeys
      ? provider === 'openrouter'
        ? [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEYS]
        : provider === 'openai'
          ? [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEYS]
          : [
              process.env.GEMINI_API_KEY ||
                process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
                process.env.GOOGLE_API_KEY,
              process.env.GEMINI_API_KEYS,
            ]
      : [];
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
        .filter((v) =>
          /^[\x21-\x7e]{8,512}$/.test(v) && !v.toLowerCase().startsWith('chatgpt_sub_')
        )
    ),
  ].slice(0, 5);
}
/** Correct across split UTF-8, CRLF, multiple data lines and an unterminated final event. */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  maxTotalBytes = Number.POSITIVE_INFINITY,
  signal?: AbortSignal
): AsyncGenerator<any> {
  const reader = body.getReader();
  const abortReader = () => {
    void reader.cancel().catch(() => {});
  };
  if (signal?.aborted) abortReader();
  else signal?.addEventListener('abort', abortReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let totalBytes = 0;
  function parse() {
    const text = data.join('\n');
    data = [];
    if (!text || text === '[DONE]') return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderResponseError('The provider returned an invalid stream response. Please retry.');
    }
  }
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        throw new ProviderResponseError('The provider connection ended unexpectedly. Please retry.');
      }
      const { done, value } = result;
      if (!done) {
        totalBytes += value.byteLength;
        if (totalBytes > maxTotalBytes)
          throw new Error('Provider response is too large. Please retry with a smaller request.');
      }
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
    signal?.removeEventListener('abort', abortReader);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
