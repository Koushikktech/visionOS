import { NextRequest } from 'next/server';
import type { AISpatialChatRequest } from '@/types/spatial';
import {
  SYSTEM_PROMPT,
  buildSpatialContextText,
  convertToolCallToActionFrame,
  GEMINI_TOOLS,
  OPENAI_TOOLS,
} from '@/lib/ai/prompt';
import { validateAction, assertCompleteHtml } from '@/lib/ai/actions';
import {
  guardRequest,
  createProviderSignal,
  readBoundedJson,
  RequestBodyTooLargeError,
  validateChatRequest,
  validateProviderHeaders,
} from '@/lib/ai/request';
import {
  providerKeys,
  readSSE,
  getNormalGeminiModelCandidateChain,
  cleanHeaderValue,
  isGeminiModelUnavailable,
  isGeminiThinkingSettingUnsupported,
  ProviderResponseError,
  readProviderErrorText,
} from '@/lib/ai/provider';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const denied = guardRequest(req);
  if (denied) return denied;
  let body: AISpatialChatRequest;
  try {
    const parsed = await readBoundedJson(req);
    validateChatRequest(parsed);
    validateProviderHeaders(req, parsed.provider || 'gemini');
    body = parsed;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid request.' },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }
    );
  }
  const provider = body.provider || 'gemini';
  const keys = providerKeys(req, body, provider);
  if (!keys.length)
    return Response.json(
      {
        error: `${provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'OpenRouter'} API Key is required. Add a key in settings.`,
      },
      { status: 401 }
    );
  const requestedModel =
    cleanHeaderValue(body.model) ||
    (provider === 'gemini'
      ? process.env.GEMINI_MODEL || 'gemini-3.8-flash'
      : provider === 'openai'
        ? process.env.OPENAI_MODEL || 'gpt-4o'
        : process.env.OPENROUTER_MODEL || 'openai/gpt-4o');

  const modelCandidates =
    provider === 'gemini'
      ? getNormalGeminiModelCandidateChain(requestedModel)
      : [requestedModel];
  const model = modelCandidates[0];
  let usedModel = model;
  const allow = body.interactionMode !== 'chat_only';
  const providerRequest = createProviderSignal(req);
  const signal = providerRequest.signal;
  const system = `${SYSTEM_PROMPT}\n\n${buildSpatialContextText(body)}`;
  const history = body.messages.filter((m) => m.content.trim());
  const temperature =
    typeof body.temperature === 'number'
      ? Math.max(0, Math.min(1, body.temperature))
      : 0.35;
  let payload: any;
  if (provider === 'openrouter' || provider === 'openai') {
    payload = {
      model,
      messages: [
        { role: 'system', content: system },
        ...history.map((m, i) =>
          i === history.length - 1 && m.role === 'user' && body.visualSnapshot
            ? {
                ...m,
                content: [
                  { type: 'text', text: m.content },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${body.visualSnapshot.mimeType};base64,${body.visualSnapshot.base64.replace(/^data:[^;]+;base64,/, '')}`,
                    },
                  },
                ],
              }
            : m
        ),
      ],
      stream: true,
      temperature,
      max_tokens: 16000,
      ...(body.thinkingMode ? { reasoning: { max_tokens: 2048 } } : {}),
      ...(allow ? { tools: OPENAI_TOOLS, tool_choice: 'auto' } : {}),
    };
  } else {
    const contents: Array<{ role: string; parts: any[] }> = [];
    const firstUser = history.findIndex((m) => m.role === 'user');
    for (const [index, m] of history.slice(Math.max(0, firstUser)).entries()) {
      const role = m.role === 'user' ? 'user' : 'model';
      const parts: any[] = [{ text: m.content }];
      if (
        index === history.slice(Math.max(0, firstUser)).length - 1 &&
        role === 'user' &&
        body.visualSnapshot
      )
        parts.push({
          inlineData: {
            mimeType: body.visualSnapshot.mimeType,
            data: body.visualSnapshot.base64.replace(/^data:[^;]+;base64,/, ''),
          },
        });
      if (contents.at(-1)?.role === role) contents.at(-1)!.parts.push(...parts);
      else contents.push({ role, parts });
    }
    payload = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens: 16000,
        ...(body.thinkingMode
          ? {
              thinkingConfig: {
                thinkingBudget: 2048,
                includeThoughts: true,
              },
            }
          : {}),
      },
      ...(allow
        ? {
            tools: GEMINI_TOOLS,
            toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          }
        : {}),
    };
  }
  let upstream: Response | null = null;
  let usedKeyIndex = 0;
  let lastStatus = 502;
  try {
    modelLoop: for (const currentModel of modelCandidates) {
      let advanceModel = false;
      for (let i = 0; i < keys.length; i++) {
        signal.throwIfAborted();
        const url =
          provider === 'openrouter'
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : provider === 'openai'
              ? 'https://api.openai.com/v1/chat/completions'
              : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:streamGenerateContent?alt=sse`;
        const headers: Record<string, string> =
          provider === 'openrouter' || provider === 'openai'
            ? {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${keys[i]}`,
                ...(provider === 'openrouter'
                  ? {
                      'HTTP-Referer': 'https://visionos.local',
                      'X-Title': 'visionOS Spatial Intelligence',
                    }
                  : {}),
              }
            : { 'Content-Type': 'application/json', 'x-goog-api-key': keys[i] };
        let res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal,
        });
        let errText = '';
        // Some models reject thinking settings or parameters; retry with clean options
        if (
          !res.ok &&
          provider === 'gemini' &&
          payload.generationConfig?.thinkingConfig
        ) {
          errText = await readProviderErrorText(res.clone());
          if (isGeminiThinkingSettingUnsupported(res.status, errText)) {
            const cleanPayload = {
              ...payload,
              generationConfig: { ...payload.generationConfig },
            };
            delete cleanPayload.generationConfig.thinkingConfig;
            res = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(cleanPayload),
              signal,
            });
            errText = res.ok ? '' : await readProviderErrorText(res.clone());
          }
        }
        if (res.ok && res.body) {
          upstream = res;
          usedKeyIndex = i;
          usedModel = currentModel;
          break modelLoop;
        }
        lastStatus = res.status;
        if (!errText) errText = await readProviderErrorText(res.clone());
        await res.body?.cancel();

        if (provider === 'gemini' && isGeminiModelUnavailable(res.status, errText)) {
          console.warn(
            `[VisionOS] Model ${currentModel} is unavailable (HTTP ${res.status}); trying an approved same-family fallback.`
          );
          advanceModel = true;
          break;
        }

        if ([401, 403, 429, 500, 502, 503, 504].includes(res.status)) continue;
        break modelLoop;
      }
      if (!upstream && !advanceModel) break modelLoop;
    }
  } catch (error) {
    providerRequest.dispose();
    console.error(
      '[VisionOS] Provider connection failed',
      error instanceof Error ? error.name : 'unknown'
    );
    return Response.json(
      {
        error: signal.aborted
          ? 'Generation timed out or was cancelled.'
          : 'Could not reach the model provider. Please retry.',
      },
      { status: signal.aborted ? 504 : 502 }
    );
  }
  if (!upstream?.body) {
    providerRequest.dispose();
    return Response.json(
      {
        error:
          lastStatus === 429
            ? 'The provider rate limit was reached. Retry shortly.'
            : `The provider rejected this request (${lastStatus}). Check the model ID and credentials.`,
      },
      { status: lastStatus >= 400 && lastStatus < 600 ? lastStatus : 502 }
    );
  }
  const encoder = new TextEncoder();
  const input = upstream.body;
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      const emit = (event: unknown) => {
        if (!controller.signal.aborted)
          output.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };
      const calls = new Map<number, { name: string; args: string }>();
      const actions: unknown[] = [];
      let publicText = '';
      let providerFinished = false;
      const emitTool = (name: string, args: unknown) => {
        if (!allow)
          throw new Error(
            'The model attempted a canvas edit in Chat only mode.'
          );
        const frame = convertToolCallToActionFrame(name, args);
        if (!frame)
          throw new Error('The model requested an unsupported canvas action.');
        validateAction(frame);
        if (frame.op === 'spawn_artifact' || frame.op === 'mutate_artifact')
          assertCompleteHtml(frame.code);
        // Stage mutations until the provider confirms a complete response.
        actions.push(frame);
      };
      try {
        for await (const event of readSSE(input, 16_000_000, signal)) {
          if (controller.signal.aborted) break;
          if (event.error)
            throw new Error(
              'The provider failed during generation. Please retry.'
            );
          if (provider === 'gemini') {
            if (event.promptFeedback?.blockReason)
              throw new Error(
                'The provider could not fulfill this request. Try rephrasing it.'
              );
            const candidate = event.candidates?.[0];
            if (candidate?.finishReason) {
              if (!['STOP', 'TOOL_CALLS'].includes(candidate.finishReason))
                throw new Error(
                  'The response was incomplete or blocked. Try a smaller request.'
                );
              providerFinished = true;
            }
            for (const part of candidate?.content?.parts || []) {
              if (part.thought || (part as any).thoughtContent) {
                const thoughtText = part.text || (part as any).thought || '';
                if (thoughtText) {
                  emit({ t: 'thought', chunk: thoughtText });
                }
              } else if (part.text) {
                const text = part.text;
                // Parse inline <thought> or <think> tags if model emits them in text
                const thoughtMatch = text.match(/<(?:thought|think)>([\s\S]*?)<\/(?:thought|think)>/i);
                if (thoughtMatch) {
                  const thoughtText = thoughtMatch[1];
                  const remainingText = text.replace(/<(?:thought|think)>[\s\S]*?<\/(?:thought|think)>/gi, '').trim();
                  emit({ t: 'thought', chunk: thoughtText });
                  if (remainingText) {
                    publicText += remainingText;
                    emit({ t: 'text', chunk: remainingText });
                  }
                } else {
                  publicText += text;
                  emit({ t: 'text', chunk: text });
                }
              }
              if (part.functionCall)
                emitTool(part.functionCall.name, part.functionCall.args);
            }
          } else {
            const choice = event.choices?.[0];
            if (choice?.finish_reason) {
              if (!['stop', 'tool_calls'].includes(choice.finish_reason))
                throw new Error(
                  'The response was incomplete or blocked. Try a smaller request.'
                );
              providerFinished = true;
            }
            const delta = choice?.delta;
            const reasoning =
              (delta as any)?.reasoning_content || (delta as any)?.thought;
            if (typeof reasoning === 'string' && reasoning) {
              emit({ t: 'thought', chunk: reasoning });
            }
            if (typeof delta?.content === 'string') {
              publicText += delta.content;
              emit({ t: 'text', chunk: delta.content });
            }
            for (const call of delta?.tool_calls || []) {
              const entry = calls.get(call.index ?? 0) || {
                name: '',
                args: '',
              };
              if (call.function?.name) entry.name += call.function.name;
              if (call.function?.arguments)
                entry.args += call.function.arguments;
              if (entry.args.length > 400000)
                throw new Error('The generated action is too large.');
              calls.set(call.index ?? 0, entry);
            }
          }
          if (publicText.length > 120000)
            throw new Error('Response too long. Please narrow the request.');
        }
        if (controller.signal.aborted) return;
        if (!providerFinished)
          throw new Error(
            signal.aborted
              ? 'Generation timed out or was cancelled.'
              : 'The connection ended before the provider completed its response. Retry.'
          );
        for (const entry of calls.values())
          emitTool(entry.name, JSON.parse(entry.args));
        for (const frame of actions) emit({ t: 'action', frame });
        emit({ t: 'done' });
      } catch (error) {
        emit({
          t: 'error',
          message:
            error instanceof ProviderResponseError
              ? error.message
              : error instanceof SyntaxError
                ? 'The provider returned invalid structured data. Please retry.'
                : error instanceof Error
                  ? error.message
                  : 'The response could not be parsed. Please retry.',
        });
      } finally {
        providerRequest.dispose();
        if (!controller.signal.aborted) output.close();
      }
    },
    cancel() {
      controller.abort();
      providerRequest.abort(new Error('Client cancelled response.'));
      void input.cancel().catch(() => {});
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Selected-Provider': provider,
      'X-Requested-Model': model,
      'X-Selected-Model': usedModel,
      'X-Key-Index': String(usedKeyIndex),
    },
  });
}
