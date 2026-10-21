import { describe, it, expect } from 'bun:test';
import { POST } from './route';
import { NextRequest } from 'next/server';

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
});
