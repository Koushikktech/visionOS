import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { providerKeys } from '@/lib/ai/provider';

describe('AI provider BYOK contract', () => {
  it('accepts user-supplied OpenAI API keys from supported request fields and headers', () => {
    const request = new NextRequest('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      headers: { 'x-openai-api-key': 'sk-test-header-key-12345' },
    });

    expect(providerKeys(request, {}, 'openai')).toEqual(['sk-test-header-key-12345']);
    expect(
      providerKeys(request, { openaiApiKeys: ['sk-project-user-key-987654'] }, 'openai')
    ).toEqual(['sk-project-user-key-987654', 'sk-test-header-key-12345']);
  });

  it('never treats fabricated ChatGPT subscription credentials as OpenAI API keys', () => {
    const request = new NextRequest('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      headers: { 'x-openai-api-key': 'chatgpt_sub_fabricated-key-12345' },
    });
    expect(
      providerKeys(
        request,
        { openaiApiKeys: ['chatgpt_sub_another-fabricated-key', 'sk-live-user-key-12345'] },
        'openai'
      )
    ).toEqual(['sk-live-user-key-12345']);
  });

  it('does not install the retired OAuth or credential-check routes', () => {
    const retiredRoutes = [
      'src/app/api/auth/openai/token/route.ts',
      'src/app/auth/openai/callback/page.tsx',
      'src/app/api/ai/openai-check/route.ts',
    ];
    for (const route of retiredRoutes) expect(existsSync(route)).toBe(false);
  });
});

describe('Studio entrance contract', () => {
  it('never auto-sends a Studio draft or infers board storage from a localStorage key', () => {
    const canvas = readFileSync('src/components/Canvas.tsx', 'utf8');
    const dashboard = readFileSync('src/components/VisionDashboard.tsx', 'utf8');
    expect(canvas).not.toContain('ai.sendMessage(initialPrompt)');
    expect(canvas).toContain('setComposerDraft');
    expect(canvas).toContain("recovery.status === 'conflict'");
    expect(dashboard).not.toContain("getItem('visionos-board-store')");
    expect(dashboard).not.toContain('ChatGPT Credits Active');
  });
});
