import { describe, it, expect } from 'bun:test';
import { POST } from './route';
import { NextRequest } from 'next/server';

const completeHtml = '<!doctype html><html><head><title>Canvas App</title></head><body><main>Ready</main></body></html>';
let makeRealTestRequestId = 0;

function makeRequest(body: unknown, signal?: AbortSignal) {
  return new NextRequest('http://localhost:3000/api/ai/make-real', {
    method: 'POST',
    signal,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `192.0.2.${++makeRealTestRequestId}`,
    },
  });
}

describe('Make Real API Route (/api/ai/make-real)', () => {
  it('returns 400 when image data is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai/make-real', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Turn into app' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Image data is required');
  });

  it('returns 401 when no Gemini API key is provided for Gemini provider', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai/make-real', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
        provider: 'gemini',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain('Gemini API Key is required');
  });

  it('returns 401 when no OpenRouter API key is provided for OpenRouter provider', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai/make-real', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
        provider: 'openrouter',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain('OpenRouter API Key is required');
  });

  it('sends Gemini credentials in a header instead of the provider URL', async () => {
    const previousFetch = globalThis.fetch;
    const apiKey = 'test-gemini-key-for-url-check';
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [{ text: completeHtml }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const req = new NextRequest('http://localhost:3000/api/ai/make-real', {
        method: 'POST',
        body: JSON.stringify({ provider: 'gemini', apiKey, existingCode: '<html></html>' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(capturedUrl).not.toContain(apiKey);
      expect(new URL(capturedUrl).searchParams.has('key')).toBe(false);
      expect(capturedHeaders?.get('x-goog-api-key')).toBe(apiKey);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('keeps provider error content and credentials out of logs and client errors', async () => {
    const previousFetch = globalThis.fetch;
    const previousWarn = console.warn;
    const previousError = console.error;
    const apiKey = 'test-openrouter-secret-key';
    let logs = '';
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { message: `Invalid key ${apiKey}; source was private` },
    }), { status: 401 });
    console.warn = (...args) => { logs += args.join(' '); };
    console.error = (...args) => { logs += args.join(' '); };

    try {
      const response = await POST(makeRequest({
        provider: 'openrouter',
        openRouterApiKey: apiKey,
        existingCode: '<html></html>',
      }));
      const error = JSON.stringify(await response.json());
      expect(response.status).toBe(401);
      expect(error).not.toContain(apiKey);
      expect(error).not.toContain('source was private');
      expect(logs).not.toContain(apiKey);
      expect(logs).not.toContain('source was private');
    } finally {
      globalThis.fetch = previousFetch;
      console.warn = previousWarn;
      console.error = previousError;
    }
  });

  it('maps provider transport failures to 502 without returning the fetch error', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('transport included test-secret'); };

    try {
      const response = await POST(makeRequest({
        provider: 'gemini',
        apiKey: 'test-gemini-key-1234',
        existingCode: '<html></html>',
      }));
      const error = JSON.stringify(await response.json());
      expect(response.status).toBe(502);
      expect(error).not.toContain('transport included test-secret');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('does not expose malformed or unreadable successful provider bodies', async () => {
    const previousFetch = globalThis.fetch;
    const secret = 'provider-private-body-123';
    let responseCount = 0;
    globalThis.fetch = async () => {
      responseCount += 1;
      if (responseCount === 1)
        return new Response(`{"error":"${secret}", broken}`, { status: 200 });
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error(secret));
        },
      }), { status: 200 });
    };

    try {
      for (let index = 0; index < 2; index++) {
        const response = await POST(makeRequest({
          provider: 'gemini',
          apiKey: 'test-gemini-key-1234',
          existingCode: '<html></html>',
        }));
        const error = JSON.stringify(await response.json());
        expect(response.status).toBe(502);
        expect(error).not.toContain(secret);
        expect(error).toContain('provider');
      }
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('maps a provider request aborted by the client to 504', async () => {
    const previousFetch = globalThis.fetch;
    const abortController = new AbortController();
    globalThis.fetch = async () => {
      abortController.abort(new Error('client disconnected'));
      throw new DOMException('The operation was aborted.', 'AbortError');
    };

    try {
      const response = await POST(makeRequest({
        provider: 'gemini',
        apiKey: 'test-gemini-key-1234',
        existingCode: '<html></html>',
      }, abortController.signal));
      expect(response.status).toBe(504);
      expect((await response.json()).error).toBe('Generation timed out or was cancelled.');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('falls back only within the same model family and reports the model that succeeded', async () => {
    const previousFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('/models/gemini-3.8-flash:'))
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              status: 'NOT_FOUND',
              message: 'models/gemini-3.8-flash is not found',
            },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      return new Response(JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: completeHtml }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
      const res = await POST(makeRequest({
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        apiKey: 'test-user-key-1234',
        existingCode: '<html></html>',
      }));

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.requestedModel).toBe('gemini-3.8-flash');
      expect(result.selectedModel).toBe('gemini-3.6-flash');
      expect(requestedUrls.map((url) => new URL(url).pathname)).toEqual([
        '/v1beta/models/gemini-3.8-flash:generateContent',
        '/v1beta/models/gemini-3.6-flash:generateContent',
      ]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('does not retry a generic Gemini 400 on another model', async () => {
    const previousFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'Invalid argument in request contents',
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const res = await POST(makeRequest({
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        apiKey: 'test-user-key-1234',
        existingCode: '<html></html>',
      }));

      expect(res.status).toBe(400);
      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('rejects malformed nested shape context before contacting a provider', async () => {
    const previousFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response('{}', { status: 200 });
    };

    try {
      const res = await POST(makeRequest({
        provider: 'gemini',
        apiKey: 'test-user-key-1234',
        existingCode: '<html></html>',
        selectedShapesContext: [
          { id: 'shape:doc', type: 'document', content: { hostile: true } },
        ],
      }));

      expect(res.status).toBe(400);
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('does not accept Gemini output without a successful terminal finish reason', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: completeHtml }] } }],
    }), { status: 200 });

    try {
      const res = await POST(makeRequest({
        provider: 'gemini',
        apiKey: 'test-user-key-1234',
        existingCode: '<html></html>',
      }));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('completion signal');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('rejects Gemini MAX_TOKENS output even if the returned document looks complete', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: completeHtml }] } }],
    }), { status: 200 });

    try {
      const res = await POST(makeRequest({
        provider: 'gemini',
        apiKey: 'test-user-key-1234',
        existingCode: '<html></html>',
      }));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('truncated');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('rejects OpenRouter output with no finish reason', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: completeHtml } }],
    }), { status: 200 });

    try {
      const res = await POST(makeRequest({
        provider: 'openrouter',
        openRouterApiKey: 'test-openrouter-user-key',
        existingCode: '<html></html>',
      }));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('completion signal');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('rejects truncated OpenRouter output even when it contains complete-looking HTML', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: completeHtml } }],
    }), { status: 200 });

    try {
      const res = await POST(makeRequest({
        provider: 'openrouter',
        openRouterApiKey: 'test-openrouter-user-key',
        existingCode: '<html></html>',
      }));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('truncated');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
