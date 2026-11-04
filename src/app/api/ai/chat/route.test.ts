import { describe, expect, it } from 'bun:test';
import { NextRequest } from 'next/server';
import { POST } from './route';

let chatRequestId = 0;

function makeRequest(model = 'gemini-3.8-flash', thinkingMode = false) {
  return new NextRequest('http://localhost:3000/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `198.51.100.${++chatRequestId}`,
    },
    body: JSON.stringify({
      provider: 'gemini',
      model,
      apiKey: 'test-gemini-key-1234',
      messages: [{ role: 'user', content: 'Say hello.' }],
      culledContext: {
        selectedNodes: [],
        viewportNeighbors: [],
        macroClusters: [],
        totalTokenEstimate: 0,
      },
      interactionMode: 'chat_only',
      thinkingMode,
    }),
  });
}

const streamResponse = () =>
  new Response(
    `data: ${JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'Hello back.' }] },
        },
      ],
    })}\n\n`,
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );

describe('normal Gemini chat model fallback', () => {
  it('sends the BYOK credential only in the provider header', async () => {
    const previousFetch = globalThis.fetch;
    const apiKey = 'test-gemini-key-1234';
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return streamResponse();
    };

    try {
      const response = await POST(makeRequest());
      expect(response.status).toBe(200);
      expect(capturedUrl).not.toContain(apiKey);
      expect(new URL(capturedUrl).searchParams.has('key')).toBe(false);
      expect(capturedHeaders?.get('x-goog-api-key')).toBe(apiKey);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('aborts and cancels the provider stream when the client cancels its response', async () => {
    const previousFetch = globalThis.fetch;
    let providerSignal: AbortSignal | undefined;
    let providerBodyCancelled = false;
    const event = new TextEncoder().encode(`data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Partial response.' }] } }],
    })}\n\n`);
    globalThis.fetch = async (_input, init) => {
      providerSignal = init?.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(event);
        },
        cancel() {
          providerBodyCancelled = true;
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    try {
      const response = await POST(makeRequest());
      await response.body?.cancel();
      expect(providerSignal?.aborted).toBe(true);
      expect(providerBodyCancelled).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('does not expose malformed provider stream content or body read errors', async () => {
    const previousFetch = globalThis.fetch;
    const secret = 'provider-private-stream-123';
    let responseCount = 0;
    globalThis.fetch = async () => {
      responseCount += 1;
      if (responseCount === 1)
        return new Response(`data: {"secret":"${secret}"\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error(secret));
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    try {
      for (let index = 0; index < 2; index++) {
        const response = await POST(makeRequest());
        const streamOutput = await response.text();
        expect(response.status).toBe(200);
        expect(streamOutput).not.toContain(secret);
        expect(streamOutput).toContain('Please retry.');
      }
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('reports the actual model after an approved fallback', async () => {
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
      return streamResponse();
    };

    try {
      const response = await POST(makeRequest());
      expect(response.status).toBe(200);
      expect(response.headers.get('X-Requested-Model')).toBe('gemini-3.8-flash');
      expect(response.headers.get('X-Selected-Model')).toBe('gemini-3.6-flash');
      expect(requestedUrls.map((url) => new URL(url).pathname)).toEqual([
        '/v1beta/models/gemini-3.8-flash:streamGenerateContent',
        '/v1beta/models/gemini-3.6-flash:streamGenerateContent',
      ]);
      expect(await response.text()).toContain('"t":"done"');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('does not retry a generic 400 on a different model', async () => {
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
      const response = await POST(makeRequest());
      expect(response.status).toBe(400);
      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('retries a structured unsupported thinking setting on the same model', async () => {
    const previousFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    const payloads: Array<Record<string, any>> = [];
    globalThis.fetch = async (input, init) => {
      requestedUrls.push(String(input));
      payloads.push(JSON.parse(String(init?.body)));
      if (payloads.length === 1)
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              message: "Unknown name 'thinkingConfig' at 'generationConfig': Cannot find field.",
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      return streamResponse();
    };

    try {
      const response = await POST(makeRequest('gemini-3.6-flash', true));
      expect(response.status).toBe(200);
      expect(requestedUrls).toHaveLength(2);
      expect(requestedUrls[0]).toBe(requestedUrls[1]);
      expect(payloads[0].generationConfig.thinkingConfig).toBeTruthy();
      expect(payloads[1].generationConfig.thinkingConfig).toBeUndefined();
      expect(response.headers.get('X-Selected-Model')).toBe('gemini-3.6-flash');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
