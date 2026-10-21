import { describe, it, expect } from 'bun:test';
import { NextRequest } from 'next/server';
import { POST as makeRealPost } from '@/app/api/ai/make-real/route';
import { POST as chatPost } from '@/app/api/ai/chat/route';
import { POST as spatialStreamPost } from '@/app/api/ai/spatial-stream/route';
import { POST as swarmPost } from '@/app/api/ai/swarm/route';

describe('API Route Schemas & Error Handling Suite (src/test/routes.test.ts)', () => {
  // =========================================================================
  // 1. /api/ai/make-real Route Testing
  // =========================================================================
  describe('Make Real API Route (/api/ai/make-real)', () => {
    it('returns 400 when image data is completely missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/make-real', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'Build an interactive calculator' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await makeRealPost(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Image data is required');
    });

    it('returns 401 when Gemini provider is selected without an API key', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/make-real', {
        method: 'POST',
        body: JSON.stringify({
          image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
          provider: 'gemini',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await makeRealPost(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toContain('Gemini API Key is required');
    });

    it('returns 401 when OpenRouter provider is selected without an API key', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/make-real', {
        method: 'POST',
        body: JSON.stringify({
          image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
          provider: 'openrouter',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await makeRealPost(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toContain('OpenRouter API Key is required');
    });

    it('handles malformed JSON body gracefully', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/make-real', {
        method: 'POST',
        body: 'invalid-json-{broken',
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await makeRealPost(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('JSON');
    });
  });

  // =========================================================================
  // 2. /api/ai/chat Route Testing
  // =========================================================================
  describe('Spatial AI Chat API Route (/api/ai/chat)', () => {
    it('returns 401 when Gemini provider has no API key supplied', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'gemini',
          culledContext: {
            selectedNodes: [],
            viewportNeighbors: [],
            macroClusters: [],
            totalTokenEstimate: 0,
          },
          messages: [{ role: 'user', content: 'Design a dashboard layout' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await chatPost(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toContain('Gemini API Key is required');
    });

    it('returns 401 when OpenRouter provider has no API key supplied', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'openrouter',
          culledContext: {
            selectedNodes: [],
            viewportNeighbors: [],
            macroClusters: [],
            totalTokenEstimate: 0,
          },
          messages: [{ role: 'user', content: 'Generate note cards' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await chatPost(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toContain('OpenRouter API Key is required');
    });

    it('returns 400 when request body is empty or invalid JSON', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/chat', {
        method: 'POST',
        body: 'not-valid-json',
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await chatPost(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('JSON');
    });
  });

  // =========================================================================
  // 3. /api/ai/spatial-stream Route Testing
  // =========================================================================
  describe('Spatial Stream API Route (/api/ai/spatial-stream)', () => {
    it('returns 500 when culledContext is missing from request body', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/ai/spatial-stream',
        {
          method: 'POST',
          body: JSON.stringify({ intent: 'organize' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const res = await spatialStreamPost(req);
      expect(res.status).toBe(500);

      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    it('streams spatial action frames when given valid organize intent and selected nodes', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/ai/spatial-stream',
        {
          method: 'POST',
          body: JSON.stringify({
            intent: 'organize',
            prompt: 'Clean up layout',
            culledContext: {
              selectedNodes: [
                { id: 'node_1', type: 'rich_card', x: 0, y: 0, w: 200, h: 100 },
                {
                  id: 'node_2',
                  type: 'rich_card',
                  x: 250,
                  y: 0,
                  w: 200,
                  h: 100,
                },
              ],
              nearbyNodes: [],
              viewport: { x: 0, y: 0, width: 1920, height: 1080, zoom: 1 },
            },
          }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const res = await spatialStreamPost(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/plain');

      // Consume stream chunk to verify structure
      const reader = res.body?.getReader();
      expect(reader).toBeDefined();

      if (reader) {
        const { value, done } = await reader.read();
        expect(done).toBe(false);
        const text = new TextDecoder().decode(value);
        expect(text).toContain('align');
        reader.cancel();
      }
    });

    it('streams connection frames when given valid connect intent', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/ai/spatial-stream',
        {
          method: 'POST',
          body: JSON.stringify({
            intent: 'connect',
            prompt: 'Connect flow',
            culledContext: {
              selectedNodes: [
                { id: 'card_a', type: 'rich_card', x: 0, y: 0, w: 200, h: 100 },
                {
                  id: 'card_b',
                  type: 'rich_card',
                  x: 300,
                  y: 0,
                  w: 200,
                  h: 100,
                },
              ],
              nearbyNodes: [],
              viewport: { x: 0, y: 0, width: 1920, height: 1080, zoom: 1 },
            },
          }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const res = await spatialStreamPost(req);
      expect(res.status).toBe(200);

      const reader = res.body?.getReader();
      if (reader) {
        const { value, done } = await reader.read();
        expect(done).toBe(false);
        const text = new TextDecoder().decode(value);
        expect(text).toContain('connect');
        reader.cancel();
      }
    });
  });

  // =========================================================================
  // 4. /api/ai/swarm Route Testing
  // =========================================================================
  describe('Swarm', () => {
    it('rejects malformed requests instead of fabricating completed work', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/swarm', {
        method: 'POST',
        body: 'invalid-json',
      });
      const res = await swarmPost(req);
      expect(res.status).toBe(400);
    });
  });
});
