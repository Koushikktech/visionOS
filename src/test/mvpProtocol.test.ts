import { describe, it, expect, afterEach } from 'bun:test';
import { NextRequest } from 'next/server';
import { validateAction, assertCompleteHtml } from '@/lib/ai/actions';
import { readStorageMessage } from '@/lib/artifactStorage';
import {
  serializeCanvas,
  compactBoard,
  contentRevision,
} from '@/lib/spatialContext';
import { readSSE } from '@/lib/ai/provider';
import { POST as chat } from '@/app/api/ai/chat/route';
import { POST as makeReal } from '@/app/api/ai/make-real/route';

const html =
  '<!DOCTYPE html><html><head><title>Counter</title></head><body><button>Count</button></body></html>';
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const context = {
  selectedNodes: [],
  viewportNeighbors: [],
  macroClusters: [],
  totalTokenEstimate: 0,
};
function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost/api/ai/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
function sse(events: unknown[], trailing = true) {
  const text =
    events.map((e) => `data: ${JSON.stringify(e)}`).join('\r\n\r\n') +
    (trailing ? '\r\n\r\n' : '');
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7)
          c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    })
  );
}

describe('MVP protocol behavior', () => {
  it('rejects malformed actions, missing targets, invalid colors, bounds and URLs', () => {
    for (const action of [
      null,
      { t: 'patch', op: 'unknown' },
      { t: 'patch', op: 'mutate_artifact', code: html },
      { t: 'patch', op: 'restyle_shape', target: 'shape:a', color: 'mauve' },
      { t: 'patch', op: 'move_shape', target: 'shape:a', x: Infinity, y: 0 },
      { t: 'patch', op: 'embed_media', mediaUrl: 'javascript:alert(1)' },
      { t: 'patch', op: 'delete_shape', nodeIds: [] },
    ])
      expect(() => validateAction(action)).toThrow();
    expect(
      validateAction({
        t: 'patch',
        op: 'mutate_artifact',
        target: 'shape:a',
        code: html,
      }).target
    ).toBe('shape:a');
  });
  it('rejects truncated or prose-only HTML', () => {
    for (const code of ['', 'Done!', '<html><body>unfinished'])
      expect(() => assertCompleteHtml(code)).toThrow();
    expect(() => assertCompleteHtml(html)).not.toThrow();
  });
  it('accepts storage only from the owning iframe and bounds payloads', () => {
    const source = {};
    const data = {
      type: 'CANVASOS_STORAGE_SYNC',
      shapeId: 'shape:a',
      storage: { count: '2' },
    };
    expect(readStorageMessage(data, {}, source, 'shape:a')).toBeNull();
    expect(readStorageMessage(data, source, source, 'shape:b')).toBeNull();
    expect(
      readStorageMessage(
        { ...data, storage: { bad: 42 } },
        source,
        source,
        'shape:a'
      )
    ).toBeNull();
    expect(readStorageMessage(data, source, source, 'shape:a')).toEqual({
      count: '2',
    });
  });
  it('serializes hierarchy, z-order, document sections and real arrow bindings', () => {
    const shapes = [
      {
        id: 'shape:doc',
        type: 'document',
        parentId: 'shape:frame',
        rotation: 0.2,
        props: {
          title: 'Plan',
          sections: [{ id: 's', title: 'Intro', content: 'Full document' }],
        },
      },
      {
        id: 'shape:arrow',
        type: 'arrow',
        parentId: 'page:1',
        rotation: 0,
        props: {},
      },
    ];
    const editor: any = {
      getCurrentPageShapesSorted: () => shapes,
      getShapePageBounds: () => ({
        minX: -100,
        minY: 200,
        maxX: 500,
        maxY: 800,
      }),
      getBindingsFromShape: () => [
        { toId: 'shape:doc', props: { terminal: 'start' } },
        { toId: 'shape:end', props: { terminal: 'end' } },
      ],
    };
    const nodes = serializeCanvas(editor);
    expect(nodes[0].sections?.[0].content).toBe('Full document');
    expect(nodes[0].parentId).toBe('shape:frame');
    expect(nodes[0].rotation).toBe(0.2);
    expect(nodes[1].zIndex).toBe(1);
    expect(nodes[1].from).toBe('shape:doc');
    expect(nodes[1].to).toBe('shape:end');
    expect(compactBoard(nodes)[0]).not.toHaveProperty('sections');
    expect(contentRevision({ content: 'A' })).not.toBe(
      contentRevision({ content: 'B' })
    );
  });
  it('parses chunked UTF-8 and trailing SSE without losing final tool calls', async () => {
    const response = sse(
      [
        { candidates: [{ content: { parts: [{ text: 'नमस्ते' }] } }] },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'mutate_artifact',
                      args: { target: 'shape:a', code: html },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
      false
    );
    const events = [];
    for await (const event of readSSE(response.body!)) events.push(event);
    expect(events[0].candidates[0].content.parts[0].text).toBe('नमस्ते');
    expect(events[1].candidates[0].content.parts[0].functionCall.name).toBe(
      'mutate_artifact'
    );
  });
  it('relays Gemini native mutation in an unterminated SSE event', async () => {
    globalThis.fetch = (async () =>
      sse(
        [
          {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: 'mutate_artifact',
                        args: { target: 'shape:a', code: html },
                      },
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          },
        ],
        false
      )) as typeof fetch;
    const response = await chat(
      request('chat', {
        messages: [{ role: 'user', content: 'Make this light' }],
        culledContext: context,
        apiKey: 'test-key-12345',
      })
    );
    const text = await response.text();
    expect(text).toContain('mutate_artifact');
    expect(text).toContain('shape:a');
    expect(text).toContain('"t":"done"');
  });
  it('accumulates OpenRouter arguments split across chunks', async () => {
    const args = JSON.stringify({ target: 'shape:a', code: html });
    globalThis.fetch = (async () =>
      sse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: 'mutate_artifact',
                      arguments: args.slice(0, 20),
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: args.slice(20) } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ])) as typeof fetch;
    const response = await chat(
      request('chat', {
        provider: 'openrouter',
        openRouterApiKey: 'test-key-12345',
        messages: [{ role: 'user', content: 'Remake this' }],
        culledContext: context,
      })
    );
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.filter((e) => e.t === 'action')).toHaveLength(1);
    expect(events.find((e) => e.t === 'action').frame.code).toBe(html);
  });
  it('never emits actions in Chat only mode, even if provider violates the tools setting', async () => {
    globalThis.fetch = (async (_url, options) => {
      expect(JSON.parse(String(options?.body)).tools).toBeUndefined();
      return sse([
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'delete_shapes',
                      args: { nodeIds: ['shape:a'] },
                    },
                  },
                ],
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;
    const res = await chat(
      request('chat', {
        apiKey: 'test-key-12345',
        interactionMode: 'chat_only',
        messages: [{ role: 'user', content: 'Explain' }],
        culledContext: context,
      })
    );
    const text = await res.text();
    expect(text).not.toContain('"t":"action"');
    expect(text).toContain('"t":"error"');
  });
  it('reports malformed tool arguments and truncation without completion', async () => {
    globalThis.fetch = (async () =>
      sse([
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'mutate_artifact',
                      args: { code: html },
                    },
                  },
                ],
              },
            },
          ],
        },
      ])) as typeof fetch;
    const res = await chat(
      request('chat', {
        apiKey: 'test-key-12345',
        messages: [{ role: 'user', content: 'Remake' }],
        culledContext: context,
      })
    );
    const text = await res.text();
    expect(text).toContain('"t":"error"');
    expect(text).not.toContain('"t":"done"');
  });
  it('regenerates from full source without requiring an iframe screenshot', async () => {
    let payload: any;
    globalThis.fetch = (async (_url, options) => {
      payload = JSON.parse(String(options?.body));
      return Response.json({
        candidates: [
          { content: { parts: [{ text: html }] }, finishReason: 'STOP' },
        ],
      });
    }) as typeof fetch;
    const res = await makeReal(
      request('make-real', {
        apiKey: 'test-key-12345',
        existingCode: html,
        prompt: 'Use light colors',
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe(html);
    expect(payload.contents[0].parts[0].text).toContain(html);
    expect(payload.contents[0].parts).toHaveLength(1);
  });
  it('rejects partial generated apps instead of replacing working content', async () => {
    globalThis.fetch = (async () =>
      Response.json({
        candidates: [
          {
            content: { parts: [{ text: '<html><body>partial' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      })) as typeof fetch;
    const res = await makeReal(
      request('make-real', {
        apiKey: 'test-key-12345',
        existingCode: html,
        prompt: 'Remake',
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).code).toBeUndefined();
  });
});
