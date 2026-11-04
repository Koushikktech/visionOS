import { describe, expect, it } from 'bun:test';
import { NextRequest } from 'next/server';
import {
  getGeminiModelCandidateChain,
  getNormalGeminiModelCandidateChain,
  isGeminiModelUnavailable,
  isGeminiThinkingSettingUnsupported,
  readProviderErrorText,
  readProviderJson,
  readSSE,
  providerKeys,
} from './provider';

describe('provider credential selection', () => {
  it('selects OpenAI API keys and excludes fabricated ChatGPT subscription tokens', () => {
    const request = new NextRequest('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'x-openai-api-key': 'sk-user-header-key-12345' },
    });
    expect(
      providerKeys(
        request,
        {
          openaiApiKeys: ['chatgpt_sub_fake-token-12345', 'sk-user-body-key-67890'],
        },
        'openai'
      )
    ).toEqual(['sk-user-body-key-67890', 'sk-user-header-key-12345']);
  });
});

describe('normal Gemini model fallback policy', () => {
  it('limits fallback to a known same-family model and keeps unknown IDs exact', () => {
    expect(getNormalGeminiModelCandidateChain('gemini-3.8-flash')).toEqual([
      'gemini-3.8-flash',
      'gemini-3.6-flash',
    ]);
    expect(getNormalGeminiModelCandidateChain('gemini-3.5-flash-lite')).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
    ]);
    expect(getNormalGeminiModelCandidateChain('gemini-4-argon')).toEqual([
      'gemini-4-argon',
    ]);
    expect(getNormalGeminiModelCandidateChain('custom/model-id')).toEqual([
      'custom/model-id',
    ]);
  });

  it('preserves the separate legacy candidate policy used by Swarm', () => {
    expect(getGeminiModelCandidateChain('gemini-3.8-flash')).toContain(
      'gemini-2.5-pro'
    );
    expect(getNormalGeminiModelCandidateChain('gemini-3.8-flash')).not.toContain(
      'gemini-2.5-pro'
    );
  });

  it('advances only for structured model availability errors', () => {
    expect(
      isGeminiModelUnavailable(
        404,
        JSON.stringify({
          error: {
            code: 404,
            status: 'NOT_FOUND',
            message: 'models/gemini-test is not found',
          },
        })
      )
    ).toBe(true);
    expect(
      isGeminiModelUnavailable(
        400,
        JSON.stringify({
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'Invalid argument in request contents',
          },
        })
      )
    ).toBe(false);
    expect(
      isGeminiModelUnavailable(
        404,
        JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Resource not found' } })
      )
    ).toBe(false);
  });

  it('recognizes only structured thinking-setting rejection errors', () => {
    expect(
      isGeminiThinkingSettingUnsupported(
        400,
        JSON.stringify({
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: "Unknown name 'thinkingConfig' at 'generationConfig': Cannot find field.",
          },
        })
      )
    ).toBe(true);
    expect(
      isGeminiThinkingSettingUnsupported(
        400,
        JSON.stringify({
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'Invalid argument for request',
          },
        })
      )
    ).toBe(false);
    expect(
      isGeminiThinkingSettingUnsupported(
        401,
        JSON.stringify({
          error: {
            code: 401,
            status: 'UNAUTHENTICATED',
            message: 'thinkingConfig unsupported',
          },
        })
      )
    ).toBe(false);
  });
});

describe('provider response bounds', () => {
  it('returns valid provider JSON and replaces malformed body details with a safe error', async () => {
    await expect(readProviderJson(new Response('{"ok":true}'))).resolves.toEqual({ ok: true });
    const secret = 'provider-private-value-123';
    try {
      await readProviderJson(new Response(`{"secret":"${secret}", broken}`));
      throw new Error('Expected malformed provider JSON to reject.');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).toContain('invalid response');
    }
  });

  it('replaces provider body read failures and bounds successful JSON bodies', async () => {
    const failingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('provider-private-value-456'));
      },
    });
    await expect(readProviderJson(new Response(failingBody))).rejects.toThrow(
      'Could not read the provider response'
    );

    await expect(readProviderJson(new Response('x'.repeat(100)), 32)).rejects.toThrow(
      'provider response is too large'
    );
  });

  it('reads only a bounded provider error prefix and cancels the remaining body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(1024)));
      },
      cancel() {
        cancelled = true;
      },
    });

    const text = await readProviderErrorText(new Response(body), 64);
    expect(text).toBe('x'.repeat(64));
    expect(cancelled).toBe(true);
  });

  it('stops chat parsing when the provider stream exceeds its configured total-byte cap', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('data: {}\n\n'));
      },
    });
    const consume = async () => {
      for await (const _event of readSSE(body, 8)) {
        // No event should be emitted after the byte budget has been exceeded.
      }
    };

    await expect(consume()).rejects.toThrow('Provider response is too large');
  });
});
