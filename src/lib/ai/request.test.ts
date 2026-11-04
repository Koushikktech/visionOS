import { describe, expect, it } from 'bun:test';
import { NextRequest } from 'next/server';
import { POST as chatPost } from '@/app/api/ai/chat/route';
import { POST as swarmPost } from '@/app/api/ai/swarm/route';
import {
  RequestBodyTooLargeError,
  validateChatRequest,
  validateMakeRealRequest,
  validateProviderHeaders,
  validateSpatialStreamRequest,
} from './request';

let chatTestRequestId = 0;

function chatRequest(body: BodyInit, extraHeaders: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `198.51.100.${++chatTestRequestId}`,
      ...extraHeaders,
    },
    body,
  });
}

function validChatRequest(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'gemini',
    apiKey: 'user-key-for-request-test',
    messages: [{ role: 'user', content: 'Summarize my selected notes.' }],
    culledContext: {
      selectedNodes: [
        {
          id: 'shape:document',
          type: 'document',
          minX: 0,
          minY: 0,
          maxX: 400,
          maxY: 300,
          title: 'Notes',
          sections: [{ id: 'section-1', title: '', content: 'Existing text.' }],
          slides: [{
            id: 'slide-1',
            title: 'Overview',
            bullets: ['First point'],
            stats: [{ label: 'Items', value: '3' }],
            columns: [{ title: 'A', text: 'B' }],
            timelineSteps: [{ step: '1', title: 'Start', desc: 'Begin' }],
          }],
          storage: { theme: 'midnight' },
          intrinsicW: 400,
          intrinsicH: 300,
          isLocked: false,
          metadata: { revision: 'abc123' },
        },
      ],
      viewportNeighbors: [],
      macroClusters: [],
      totalTokenEstimate: 20,
    },
    ...overrides,
  };
}

describe('AI request runtime schemas', () => {
  it('accepts the current client context shape, including optional nested fields', () => {
    expect(() => validateChatRequest(validChatRequest())).not.toThrow();
  });

  it('accepts OpenAI BYOK credentials and rejects retired or fabricated credentials before provider work', async () => {
    const byokRequest = validChatRequest({
      provider: 'openai',
      openaiApiKey: 'sk-project-client-key-12345',
    });
    expect(() => validateChatRequest(byokRequest)).not.toThrow();

    const previousFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response('{}', { status: 200 });
    };
    try {
      const legacyOAuthRequest = validChatRequest({
        provider: 'openai',
        chatgptOAuthToken: 'chatgpt_sub_fabricated-token-12345',
      });
      const legacyResponse = await chatPost(chatRequest(JSON.stringify(legacyOAuthRequest)));
      expect(legacyResponse.status).toBe(400);

      const fabricatedApiKeyRequest = validChatRequest({
        provider: 'openai',
        openaiApiKey: 'chatgpt_sub_fabricated-token-12345',
      });
      const fabricatedResponse = await chatPost(chatRequest(JSON.stringify(fabricatedApiKeyRequest)));
      expect(fabricatedResponse.status).toBe(400);
      expect(fetchCount).toBe(0);

      expect(() => validateProviderHeaders(
        new Request('http://localhost', {
          headers: { 'x-openai-api-key': 'chatgpt_sub_fabricated-token-12345' },
        }),
        'openai'
      )).toThrow(/not a provider API key/i);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('accepts bounded selected deck source for the native deck tool flow', () => {
    const body = validChatRequest();
    const node = (body.culledContext as { selectedNodes: Record<string, unknown>[] }).selectedNodes[0];
    node.type = 'slide_deck';
    node.theme = 'ocean';
    node.currentSlideIndex = 1;
    node.slides = [
      { id: 'slide-1', title: 'Opening', speakerNotes: 'Introduce the goal.' },
      { id: 'slide-2', title: 'Plan', layout: 'timeline', timelineSteps: [{ step: '1', title: 'Build', desc: 'Prepare the release.' }] },
    ];
    expect(() => validateChatRequest(body)).not.toThrow();

    node.currentSlideIndex = 1.5;
    expect(() => validateChatRequest(body)).toThrow(/currentSlideIndex/i);
    node.currentSlideIndex = 1;
    node.slides = Array.from({ length: 101 }, (_, index) => ({ id: `slide-${index}`, title: 'Slide' }));
    expect(() => validateChatRequest(body)).toThrow(/too many items/i);
  });

  it('rejects malformed nested sections, slides, storage, geometry and snapshot values', () => {
    const malformed = [
      { sections: [null] },
      { slides: [{ id: 's', title: { html: 'wrong type' } }] },
      { storage: { value: { nested: true } } },
      { intrinsicW: '400' },
    ];
    for (const nodeFields of malformed) {
      const body = validChatRequest();
      const nodes = (body.culledContext as { selectedNodes: Record<string, unknown>[] }).selectedNodes;
      Object.assign(nodes[0], nodeFields);
      expect(() => validateChatRequest(body)).toThrow();
    }

    const snapshotBody = validChatRequest({ visualSnapshot: null });
    expect(() => validateChatRequest(snapshotBody)).toThrow();
    expect(() => validateChatRequest(validChatRequest({ apiKeys: [null] }))).toThrow();
  });

  it('rejects extreme arrays and field sizes with a 413-class validation error', () => {
    const body = validChatRequest();
    const nodes = (body.culledContext as { selectedNodes: unknown[] }).selectedNodes;
    body.messages = Array.from({ length: 61 }, () => ({ role: 'user', content: 'x' }));
    expect(() => validateChatRequest(body)).toThrow(RequestBodyTooLargeError);
    body.messages = [{ role: 'user', content: 'x' }];
    nodes.push(...Array.from({ length: 300 }, () => nodes[0]));
    expect(() => validateChatRequest(body)).toThrow(RequestBodyTooLargeError);
  });

  it('checks Make Real selected-shape nesting and spatial-stream selection fields', () => {
    expect(() => validateMakeRealRequest({
      existingCode: '<html></html>',
      selectedShapesContext: [{ id: 'shape:1', type: 'doc', content: null }],
    })).toThrow();

    expect(() => validateSpatialStreamRequest({
      intent: 'organize',
      culledContext: { selectedNodes: [{ id: 'shape:1', type: 'card', x: null }] },
    })).toThrow();
  });

  it('rejects malformed nested chat input before any provider fetch', async () => {
    const previousFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response('{}', { status: 200 });
    };
    try {
      const body = validChatRequest();
      const nodes = (body.culledContext as { selectedNodes: Record<string, unknown>[] }).selectedNodes;
      nodes[0].sections = [{ id: 'section-1', title: 'Bad section', content: null }];
      const req = chatRequest(JSON.stringify(body));

      const res = await chatPost(req);
      expect(res.status).toBe(400);
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('enforces the streaming body cap when Content-Length is absent, before provider work', async () => {
    const previousFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response('{}', { status: 200 });
    };
    try {
      const body = JSON.stringify({ ...validChatRequest(), extra: 'x'.repeat(8_000_100) });
      const req = chatRequest(body);
      expect(req.headers.get('content-length')).toBeNull();

      const res = await chatPost(req);
      expect(res.status).toBe(413);
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('bounds provider credential headers before any provider fetch', async () => {
    const previousFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response('{}', { status: 200 });
    };
    try {
      const body = JSON.stringify(validChatRequest());
      const res = await chatPost(chatRequest(body, {
        'x-gemini-api-keys': 'k'.repeat(26_001),
      }));
      expect(res.status).toBe(413);
      expect(fetchCount).toBe(0);
      expect(() => validateProviderHeaders(
        new Request('http://localhost', { headers: { 'x-gemini-api-key': 'short' } }),
        'gemini'
      )).toThrow();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('does not use configured environment keys for production requests without a client key', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previousFetch = globalThis.fetch;
    const previousNodeEnv = env.NODE_ENV;
    const previousGeminiKey = env.GEMINI_API_KEY;
    const previousOptIn = env.ALLOW_SERVER_AI_KEYS;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response('{}', { status: 200 });
    };
    env.NODE_ENV = 'production';
    env.GEMINI_API_KEY = 'server-configured-key';
    env.ALLOW_SERVER_AI_KEYS = 'true';
    try {
      const body = Object.fromEntries(
        Object.entries(validChatRequest()).filter(([key]) => key !== 'apiKey')
      );
      const res = await chatPost(chatRequest(JSON.stringify(body)));
      expect(res.status).toBe(401);
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previousNodeEnv;
      if (previousGeminiKey === undefined) delete env.GEMINI_API_KEY;
      else env.GEMINI_API_KEY = previousGeminiKey;
      if (previousOptIn === undefined) delete env.ALLOW_SERVER_AI_KEYS;
      else env.ALLOW_SERVER_AI_KEYS = previousOptIn;
    }
  });

  it('uses a supplied invalid client key instead of falling through to a server key', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previousFetch = globalThis.fetch;
    const previousNodeEnv = env.NODE_ENV;
    const previousGeminiKey = env.GEMINI_API_KEY;
    const previousOptIn = env.ALLOW_SERVER_AI_KEYS;
    const seenKeys: string[] = [];
    globalThis.fetch = async (_input, init) => {
      seenKeys.push(new Headers(init?.headers).get('x-goog-api-key') || '');
      return new Response('{}', { status: 401 });
    };
    env.NODE_ENV = 'development';
    env.GEMINI_API_KEY = 'server-configured-key';
    env.ALLOW_SERVER_AI_KEYS = 'true';
    try {
      const body = validChatRequest({ apiKey: 'invalid-client-key' });
      const res = await chatPost(chatRequest(JSON.stringify(body)));
      expect(res.status).toBe(401);
      expect(seenKeys.length).toBeGreaterThan(0);
      expect(seenKeys.every((key) => key === 'invalid-client-key')).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previousNodeEnv;
      if (previousGeminiKey === undefined) delete env.GEMINI_API_KEY;
      else env.GEMINI_API_KEY = previousGeminiKey;
      if (previousOptIn === undefined) delete env.ALLOW_SERVER_AI_KEYS;
      else env.ALLOW_SERVER_AI_KEYS = previousOptIn;
    }
  });

  it('forwards the same client key through Swarm planning and its internal chat call', async () => {
    const previousFetch = globalThis.fetch;
    const clientKey = 'swarm-client-key-1234';
    const seenKeys: string[] = [];
    let callCount = 0;
    globalThis.fetch = async (_input, init) => {
      seenKeys.push(new Headers(init?.headers).get('x-goog-api-key') || '');
      callCount += 1;
      if (callCount === 1)
        return new Response(JSON.stringify({
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ text: '{"mode":"single","tasks":[]}' }] },
          }],
        }), { status: 200 });
      return new Response(
        `data: ${JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Done.' }] } }],
        })}\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
    };
    try {
      const body = validChatRequest({ apiKey: clientKey });
      (body.culledContext as { selectedNodes: unknown[] }).selectedNodes = [];
      const res = await swarmPost(new NextRequest('http://localhost:3000/api/ai/swarm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': `203.0.113.${++chatTestRequestId}`,
        },
        body: JSON.stringify(body),
      }));
      expect(res.status).toBe(200);
      expect(seenKeys).toEqual([clientKey, clientKey]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('rejects truncated Gemini swarm plans before dispatching specialists', async () => {
    const previousFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'MAX_TOKENS',
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      mode: 'parallel',
                      tasks: [
                        { title: 'One', prompt: 'Create one card.' },
                        { title: 'Two', prompt: 'Create another card.' },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      );
    };
    try {
      const body = validChatRequest();
      (body.culledContext as { selectedNodes: unknown[] }).selectedNodes = [];
      const res = await swarmPost(
        new NextRequest('http://localhost:3000/api/ai/swarm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': `203.0.113.${++chatTestRequestId}`,
          },
          body: JSON.stringify(body),
        })
      );

      expect(res.status).toBe(502);
      expect(callCount).toBe(1);
      expect(await res.json()).toMatchObject({
        error: 'Swarm planner output was truncated. Please retry.',
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('rejects an OpenRouter swarm plan without a terminal completion reason', async () => {
    const previousFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ mode: 'single', tasks: [] }),
              },
            },
          ],
        }),
        { status: 200 }
      );
    };
    try {
      const body = validChatRequest({
        provider: 'openrouter',
        apiKey: undefined,
        openRouterApiKey: 'openrouter-test-key',
      });
      (body.culledContext as { selectedNodes: unknown[] }).selectedNodes = [];
      const res = await swarmPost(
        new NextRequest('http://localhost:3000/api/ai/swarm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': `203.0.113.${++chatTestRequestId}`,
          },
          body: JSON.stringify(body),
        })
      );

      expect(res.status).toBe(502);
      expect(callCount).toBe(1);
      expect(await res.json()).toMatchObject({
        error:
          'Swarm planning ended without a successful completion signal. Please retry.',
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('rejects truncated OpenRouter swarm plans before dispatching specialists', async () => {
    const previousFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: {
                content: JSON.stringify({
                  mode: 'parallel',
                  tasks: [
                    { title: 'One', prompt: 'Create one card.' },
                    { title: 'Two', prompt: 'Create another card.' },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 }
      );
    };
    try {
      const body = validChatRequest({
        provider: 'openrouter',
        apiKey: undefined,
        openRouterApiKey: 'openrouter-test-key',
      });
      (body.culledContext as { selectedNodes: unknown[] }).selectedNodes = [];
      const res = await swarmPost(
        new NextRequest('http://localhost:3000/api/ai/swarm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': `203.0.113.${++chatTestRequestId}`,
          },
          body: JSON.stringify(body),
        })
      );

      expect(res.status).toBe(502);
      expect(callCount).toBe(1);
      expect(await res.json()).toMatchObject({
        error: 'Swarm planner output was truncated. Please retry.',
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
