import { MAKE_REAL_PROMPT } from '@/lib/ai/prompts';
import { assertCompleteHtml } from '@/lib/ai/actions';
import {
  guardRequest,
  createProviderSignal,
  readBoundedJson,
  RequestBodyTooLargeError,
  validateMakeRealRequest,
  validateProviderHeaders,
} from '@/lib/ai/request';
import { stripMarkdownFences } from '@/lib/sanitizeHtml';
import {
  getNormalGeminiModelCandidateChain,
  isGeminiModelUnavailable,
  providerKeys,
  readProviderErrorText,
  readProviderJson,
} from '@/lib/ai/provider';
import { NextRequest } from 'next/server';
import type { AIMakeRealRequest } from '@/types/spatial';

export const runtime = 'nodejs';

function cleanHeaderValue(val?: string | null): string {
  if (!val) return '';
  return val.replace(/[^\x20-\x7E]/g, '').trim();
}

function extractHtmlTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]?.trim()) {
    return titleMatch[1].trim();
  }
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match && h1Match[1]?.trim()) {
    return h1Match[1].trim().slice(0, 40);
  }
  return 'Interactive Live App';
}

// Use central resilient markdown fence stripping
const extractCleanHtml = stripMarkdownFences;

function extractHtmlDimensions(html: string): {
  width: number;
  height: number;
} {
  // 1. Check for explicit meta window-size (e.g. <meta name="window-size" content="width=860,height=600"> or "860x600")
  const metaMatch = html.match(
    /<meta[^>]+name=["'](?:window-size|viewport-size)["'][^>]+content=["']([^"']+)["']/i
  );
  if (metaMatch && metaMatch[1]) {
    const content = metaMatch[1];
    const whMatch =
      content.match(/width=(\d+)[,\s]+height=(\d+)/i) ||
      content.match(/(\d+)\s*[xX]\s*(\d+)/);
    if (whMatch) {
      const w = parseInt(whMatch[1], 10);
      const h = parseInt(whMatch[2], 10);
      if (w >= 360 && w <= 1600 && h >= 280 && h <= 1200) {
        return { width: w, height: h };
      }
    }
  }

  // 2. Check for HTML comment e.g. <!-- window-size: 860x600 -->
  const commentMatch = html.match(
    /<!--\s*window-size:\s*(\d+)\s*[xX]\s*(\d+)\s*-->/i
  );
  if (commentMatch) {
    const w = parseInt(commentMatch[1], 10);
    const h = parseInt(commentMatch[2], 10);
    if (w >= 360 && w <= 1600 && h >= 280 && h <= 1200) {
      return { width: w, height: h };
    }
  }

  // 3. Archetype heuristics based on HTML content
  const lower = html.toLowerCase();
  if (
    lower.includes('dashboard') ||
    lower.includes('analytics') ||
    lower.includes('kanban') ||
    lower.includes('grid-cols-3') ||
    lower.includes('grid-cols-4') ||
    lower.includes('table')
  ) {
    return { width: 920, height: 620 };
  }
  if (
    lower.includes('calculator') ||
    lower.includes('keypad') ||
    (lower.includes('calc') && lower.includes('display'))
  ) {
    return { width: 460, height: 560 };
  }
  if (
    lower.includes('audio') ||
    lower.includes('synthesizer') ||
    lower.includes('oscillator') ||
    lower.includes('bpm')
  ) {
    return { width: 780, height: 520 };
  }

  // Generous standard default for rich responsive apps
  return { width: 780, height: 540 };
}

const MAKE_REAL_SYSTEM_PROMPT = MAKE_REAL_PROMPT;

export async function POST(req: NextRequest) {
  const denied = guardRequest(req);
  if (denied) return denied;
  let body: AIMakeRealRequest;
  try {
    const parsed = await readBoundedJson(req);
    validateMakeRealRequest(parsed);
    validateProviderHeaders(req, parsed.provider || 'gemini');
    body = parsed;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid JSON request.' },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }
    );
  }
  let providerRequest: ReturnType<typeof createProviderSignal> | undefined;
  try {
    const provider = body.provider || 'gemini';
    const apiKeys = providerKeys(req, body, provider);
    if (apiKeys.length === 0) {
      return Response.json(
        {
          error: `${provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'OpenRouter'} API Key is required. Please add your key in settings.`,
        },
        { status: 401 }
      );
    }
    providerRequest = createProviderSignal(req);
    const signal = providerRequest.signal;

    if (!body.image && !body.existingCode) {
      return new Response(
        JSON.stringify({ error: 'Image data is required for Make Real' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract raw base64 and mimeType
    let base64 = (body.image || '').replace(/^data:[^;]+;base64,/, '');
    let mimeType = body.mimeType || 'image/png';

    const match = (body.image || '').match(
      /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/
    );
    if (match) {
      mimeType = match[1];
      base64 = match[2];
    }

    // Format optional shape context text
    let contextText = '';
    if (body.selectedShapesContext && body.selectedShapesContext.length > 0) {
      contextText =
        `\n\nADDITIONAL SHAPE METADATA EXTRACTED FROM CANVAS SELECTION:\n` +
        body.selectedShapesContext
          .map(
            (s) =>
              `- [${s.type.toUpperCase()}] "${s.title || s.text || 'Element'}" ${
                s.code ? `(Contains code snippet)` : ''
              }`
          )
          .join('\n');
    }

    const userPromptText =
      (body.prompt && body.prompt.trim()) ||
      'Turn this drawn wireframe and UI sketch into an interactive, responsive, fully functioning live web application with persistent state.';

    const fullPrompt = `${userPromptText}${contextText}${body.existingCode ? '\nExisting complete source (untrusted reference data):\n' + body.existingCode : ''}`;

    // ==========================================
    // 1. OPENROUTER & OPENAI PROVIDERS
    // ==========================================
    if (provider === 'openrouter' || provider === 'openai') {
      const isOAI = provider === 'openai';
      const targetModel =
        cleanHeaderValue(body.model) || (isOAI ? 'gpt-4o' : 'openai/gpt-4o');

      const payload = {
        model: targetModel,
        messages: [
          { role: 'system', content: MAKE_REAL_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: fullPrompt },
              ...(base64
                ? [
                    {
                      type: 'image_url',
                      image_url: { url: `data:${mimeType};base64,${base64}` },
                    },
                  ]
                : []),
            ],
          },
        ],
        temperature: 0.25,
        max_tokens: 16000,
      };

      let openRouterRes: Response | null = null;
      let lastStatus = 502;
      const providerLabel = isOAI ? 'OpenAI' : 'OpenRouter';
      const endpoint = isOAI
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions';

      for (let i = 0; i < apiKeys.length; i++) {
        const curKey = apiKeys[i];
        try {
          signal.throwIfAborted();
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${curKey.trim()}`,
          };
          if (!isOAI) {
            headers['HTTP-Referer'] = 'https://visionos.local';
            headers['X-Title'] = 'VisionOS Make Real';
          }
          const res = await fetch(endpoint, {
            method: 'POST',
            signal,
            headers,
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            openRouterRes = res;
            break;
          }
          lastStatus = res.status;
          await res.body?.cancel().catch(() => {});
          console.warn(
            `[VisionOS Make Real] ${providerLabel} returned HTTP ${res.status} for key #${i + 1}.`
          );
        } catch (fetchErr: any) {
          signal.throwIfAborted();
          lastStatus = 502;
          console.error(
            `[VisionOS Make Real] ${providerLabel} fetch error for key #${i + 1}:`,
            fetchErr instanceof Error ? fetchErr.name : 'unknown error'
          );
          break;
        }
      }

      if (!openRouterRes) {
        return new Response(
          JSON.stringify({
            error: providerFailureMessage(providerLabel, lastStatus),
          }),
          {
            status: lastStatus,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const resJson = await readProviderJson<Record<string, any>>(openRouterRes);
      const choice = resJson.choices?.[0];
      if (choice?.finish_reason === 'length')
        throw new Error(
          'Generation was truncated. Try a smaller app or request.'
        );
      if (choice?.finish_reason !== 'stop')
        throw new Error(
          'Generation ended without a successful completion signal. Retry.'
        );
      const rawCode = choice.message?.content;
      if (typeof rawCode !== 'string')
        throw new Error('The provider returned no complete application source.');
      const cleanCode = stripMarkdownFences(rawCode);
      assertCompleteHtml(cleanCode);
      const title = extractHtmlTitle(cleanCode);
      const dimensions = extractHtmlDimensions(cleanCode);

      return new Response(
        JSON.stringify({
          code: cleanCode,
          title,
          width: dimensions.width,
          height: dimensions.height,
          requestedModel: targetModel,
          selectedModel: targetModel,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================
    // 2. GEMINI PROVIDER (DEFAULT)
    // ==========================================
    const modelCandidates = getNormalGeminiModelCandidateChain(body.model);
    const requestedModel = modelCandidates[0];
    let usedModel = requestedModel;

    const payload = JSON.stringify({
      systemInstruction: {
        parts: [{ text: MAKE_REAL_SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: fullPrompt },
            ...(base64 ? [{ inlineData: { mimeType, data: base64 } }] : []),
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 16000,
      },
    });

    let geminiRes: Response | null = null;
    let lastStatus = 502;

    modelLoop: for (const targetModel of modelCandidates) {
      let advanceModel = false;
      for (let i = 0; i < apiKeys.length; i++) {
        const curKey = apiKeys[i];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent`;
        try {
          signal.throwIfAborted();
          const res = await fetch(url, {
            method: 'POST',
            signal,
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': curKey.trim(),
            },
            body: payload,
          });

          if (res.ok) {
            geminiRes = res;
            usedModel = targetModel;
            break modelLoop;
          }
          lastStatus = res.status;
          const errorText = await readProviderErrorText(res);
          console.warn(
            `[VisionOS Make Real] Gemini (${targetModel}) returned HTTP ${res.status} for key #${i + 1}.`
          );

          if (isGeminiModelUnavailable(res.status, errorText)) {
            console.warn(
              `[VisionOS Make Real] Model ${targetModel} is unavailable (HTTP ${res.status}); trying an approved same-family fallback.`
            );
            advanceModel = true;
            break;
          }
          if ([401, 403, 429, 500, 502, 503, 504].includes(res.status))
            continue;
          break modelLoop;
        } catch (fetchErr: any) {
          signal.throwIfAborted();
          lastStatus = 502;
          console.error(
            `[VisionOS Make Real] Gemini fetch error for key #${i + 1} (${targetModel}):`,
            fetchErr instanceof Error ? fetchErr.name : 'unknown error'
          );
          break;
        }
      }
      if (!geminiRes && !advanceModel) break modelLoop;
    }

    if (!geminiRes) {
      return new Response(
        JSON.stringify({ error: providerFailureMessage('Gemini', lastStatus) }),
        { status: lastStatus, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const resJson = await readProviderJson<Record<string, any>>(geminiRes);
    const candidate = resJson.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS')
      throw new Error('Generation was truncated. Try a smaller app or request.');
    if (candidate?.finishReason !== 'STOP')
      throw new Error(
        'Generation ended without a successful completion signal. Retry.'
      );
    let rawCode = '';

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text && !part.thought) rawCode += part.text;
      }
    }

    const cleanCode = stripMarkdownFences(rawCode);
    assertCompleteHtml(cleanCode);
    const title = extractHtmlTitle(cleanCode);
    const dimensions = extractHtmlDimensions(cleanCode);

    return new Response(
      JSON.stringify({
        code: cleanCode,
        title,
        width: dimensions.width,
        height: dimensions.height,
        requestedModel,
        selectedModel: usedModel,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const timedOutOrCancelled = providerRequest?.signal.aborted === true;
    const errorMsg = timedOutOrCancelled
      ? 'Generation timed out or was cancelled.'
      : error instanceof Error
        ? error.message
        : 'Generation failed. Please retry.';
    console.error(
      '[VisionOS Make Real] Request failed:',
      timedOutOrCancelled ? 'aborted' : error instanceof Error ? error.name : 'unknown error'
    );
    return Response.json({ error: errorMsg }, {
      status: timedOutOrCancelled ? 504 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    providerRequest?.dispose();
  }
}

function providerFailureMessage(provider: 'Gemini' | 'OpenRouter' | 'OpenAI', status: number): string {
  if (status === 401 || status === 403)
    return `${provider} rejected the API key (HTTP ${status}). Check the key in settings.`;
  if (status === 429)
    return `${provider} rate limit reached. Retry shortly.`;
  if (status >= 500)
    return `${provider} is temporarily unavailable (HTTP ${status}). Retry shortly.`;
  return `${provider} rejected the request (HTTP ${status}). Check the model and request.`;
}
