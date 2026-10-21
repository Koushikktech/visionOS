import { MAKE_REAL_PROMPT } from '@/lib/ai/prompts';
import { assertCompleteHtml } from '@/lib/ai/actions';
import { guardRequest, providerSignal } from '@/lib/ai/request';
import { stripMarkdownFences } from '@/lib/sanitizeHtml';
import { NextRequest } from 'next/server';
import type { AIMakeRealRequest } from '@/types/spatial';

export const runtime = 'nodejs';

function cleanHeaderValue(val?: string | null): string {
  if (!val) return '';
  return val.replace(/[^\x20-\x7E]/g, '').trim();
}

function collectKeys(
  headerSingle?: string | null,
  headerMulti?: string | null,
  bodySingle?: string | null,
  bodyMulti?: string[] | null,
  envMulti?: string,
  envSingle?: string
): string[] {
  const keysSet = new Set<string>();

  const addKey = (k?: string | null) => {
    if (!k) return;
    const cleaned = cleanHeaderValue(k);
    if (cleaned && cleaned.length >= 8) {
      keysSet.add(cleaned);
    }
  };

  const addKeysFromText = (text?: string | null) => {
    if (!text) return;
    const trimmed = text.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          arr.forEach((item) => addKey(String(item)));
          return;
        }
      } catch {}
    }
    const parts = trimmed.split(/[\n,;]+/);
    parts.forEach((p) => addKey(p));
  };

  if (Array.isArray(bodyMulti)) {
    bodyMulti.forEach((k) => addKey(k));
  }
  addKey(bodySingle);
  addKeysFromText(headerMulti);
  addKey(headerSingle);
  addKeysFromText(envMulti);
  addKey(envSingle);

  return Array.from(keysSet);
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
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON request.' }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    (body.provider && !['gemini', 'openrouter'].includes(body.provider)) ||
    (body.prompt &&
      (typeof body.prompt !== 'string' || body.prompt.length > 16000)) ||
    (body.existingCode &&
      (typeof body.existingCode !== 'string' ||
        body.existingCode.length > 180000)) ||
    (body.image &&
      (typeof body.image !== 'string' || body.image.length > 7000000))
  )
    return Response.json(
      { error: 'Invalid or oversized generation request.' },
      { status: 400 }
    );
  if (
    body.model &&
    (typeof body.model !== 'string' || !/^[\w./:-]{1,160}$/.test(body.model))
  )
    return Response.json(
      { error: 'Invalid model identifier.' },
      { status: 400 }
    );
  const signal = providerSignal(req);
  try {
    const provider = body.provider || 'gemini';

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
    // 1. OPENROUTER PROVIDER
    // ==========================================
    if (provider === 'openrouter') {
      const openRouterKeys = collectKeys(
        req.headers.get('x-openrouter-api-key'),
        req.headers.get('x-openrouter-api-keys'),
        body.openRouterApiKey,
        body.openRouterApiKeys,
        process.env.OPENROUTER_API_KEYS,
        process.env.OPENROUTER_API_KEY
      );

      if (openRouterKeys.length === 0) {
        return new Response(
          JSON.stringify({
            error:
              'OpenRouter API Key is required for Make Real. Please enter your key in settings.',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const targetModel = cleanHeaderValue(body.model) || 'openai/gpt-4o';

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
      let lastErrorText = '';
      let lastStatus = 500;

      for (let i = 0; i < openRouterKeys.length; i++) {
        const curKey = openRouterKeys[i];
        try {
          const res = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              signal,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${curKey.trim()}`,
                'HTTP-Referer': 'https://canvasos.local',
                'X-Title': 'CanvasOS Make Real',
              },
              body: JSON.stringify(payload),
            }
          );

          if (res.ok) {
            openRouterRes = res;
            break;
          }
          lastStatus = res.status;
          lastErrorText = await res.text();
          console.warn(
            `OpenRouter key #${i + 1}/${openRouterKeys.length} returned HTTP ${res.status}:`,
            lastErrorText
          );
        } catch (fetchErr: any) {
          signal.throwIfAborted();
          const cause = fetchErr?.cause?.message || fetchErr?.cause;
          lastErrorText = cause
            ? `${fetchErr?.message || String(fetchErr)}: ${cause}`
            : fetchErr?.message || String(fetchErr);
          console.error(
            `[CanvasOS Make Real] OpenRouter fetch error for key #${i + 1}:`,
            lastErrorText
          );
        }
      }

      if (!openRouterRes) {
        let cleanErrMsg = lastErrorText;
        try {
          const parsed = JSON.parse(lastErrorText);
          if (parsed?.error?.message) {
            cleanErrMsg = parsed.error.message;
          }
        } catch {}
        return new Response(
          JSON.stringify({
            error: `OpenRouter Make Real failed: ${cleanErrMsg}`,
          }),
          {
            status: lastStatus,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const resJson = await openRouterRes.json();
      const rawCode = resJson.choices?.[0]?.message?.content || '';
      if (resJson.choices?.[0]?.finish_reason === 'length')
        throw new Error(
          'Generation was truncated. Try a smaller app or request.'
        );
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
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================
    // 2. GEMINI PROVIDER (DEFAULT)
    // ==========================================
    const geminiKeys = collectKeys(
      req.headers.get('x-gemini-api-key'),
      req.headers.get('x-gemini-api-keys'),
      body.apiKey,
      body.apiKeys,
      process.env.GEMINI_API_KEYS,
      process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        process.env.GOOGLE_API_KEY
    );

    if (geminiKeys.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            'Gemini API Key is required for Make Real. Please enter your key in settings.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const targetModel =
      cleanHeaderValue(body.model) ||
      process.env.GEMINI_MODEL ||
      'gemini';

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
    let lastErrorText = '';
    let lastStatus = 500;

    keyLoop: for (let i = 0; i < geminiKeys.length; i++) {
      const curKey = geminiKeys[i];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent`;
      try {
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
          break keyLoop;
        }
        lastStatus = res.status;
        lastErrorText = await res.text();
        console.warn(
          `Gemini (${targetModel}) key #${i + 1}/${geminiKeys.length} returned HTTP ${res.status}:`,
          lastErrorText
        );
      } catch (fetchErr: any) {
        signal.throwIfAborted();
        const cause = fetchErr?.cause?.message || fetchErr?.cause;
        lastErrorText = cause
          ? `${fetchErr?.message || String(fetchErr)}: ${cause}`
          : fetchErr?.message || String(fetchErr);
        console.error(
          `[CanvasOS Make Real] Gemini fetch error for key #${i + 1} (${targetModel}):`,
          lastErrorText
        );
      }
    }

    if (!geminiRes) {
      let cleanErrMsg = lastErrorText;
      try {
        const parsed = JSON.parse(lastErrorText);
        if (parsed?.error?.message) {
          cleanErrMsg = parsed.error.message;
        }
      } catch {}
      if (
        cleanErrMsg.includes('ENOTFOUND') ||
        cleanErrMsg.includes('fetch failed')
      ) {
        cleanErrMsg =
          'Network connection or DNS resolution failed. Please verify your internet connection or proxy settings.';
      }
      return new Response(
        JSON.stringify({ error: `Gemini Make Real failed: ${cleanErrMsg}` }),
        { status: lastStatus, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const resJson = await geminiRes.json();
    const candidate = resJson.candidates?.[0];
    let rawCode = '';

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text && !part.thought) rawCode += part.text;
      }
    }

    if (candidate?.finishReason && candidate.finishReason !== 'STOP')
      throw new Error('Generation did not finish. Try a smaller request.');
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
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CanvasOS Make Real] Error:', error);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
