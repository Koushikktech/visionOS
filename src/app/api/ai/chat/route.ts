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
  providerSignal,
  validateChatRequest,
} from '@/lib/ai/request';
import {
  providerKeys,
  readSSE,
  getGeminiModelCandidateChain,
  cleanHeaderValue,
} from '@/lib/ai/provider';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const denied = guardRequest(req);
  if (denied) return denied;
  let body: AISpatialChatRequest;
  try {
    body = await req.json();
    validateChatRequest(body);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid request.' },
      { status: 400 }
    );
  }
  const provider = body.provider || 'gemini';
  const keys = providerKeys(req, body, provider);
  if (!keys.length)
    return Response.json(
      {
        error: `${provider === 'gemini' ? 'Gemini' : 'OpenRouter'} API Key is required. Configure a server key or add a session key in settings.`,
      },
      { status: 401 }
    );
  const requestedModel =
    cleanHeaderValue(body.model) ||
    (provider === 'gemini'
      ? process.env.GEMINI_MODEL || 'gemini-3.8-flash'
      : process.env.OPENROUTER_MODEL || 'openai/gpt-4o');

  const modelCandidates =
    provider === 'gemini'
      ? getGeminiModelCandidateChain(requestedModel)
      : [requestedModel];
  const model = modelCandidates[0];
  const allow = body.interactionMode !== 'chat_only';
  const signal = providerSignal(req);
  const system = `${SYSTEM_PROMPT}\n\n${buildSpatialContextText(body)}`;
  const history = body.messages.filter((m) => m.content.trim());
  const temperature =
    typeof body.temperature === 'number'
      ? Math.max(0, Math.min(1, body.temperature))
      : 0.35;
  let payload: any;
  if (provider === 'openrouter') {
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
      for (let i = 0; i < keys.length; i++) {
        signal.throwIfAborted();
        const url =
          provider === 'openrouter'
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(keys[i])}`;
        const headers: Record<string, string> =
          provider === 'openrouter'
            ? {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${keys[i]}`,
              }
            : { 'Content-Type': 'application/json', 'x-goog-api-key': keys[i] };
        let res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal,
        });
        // Some models reject thinking settings or parameters; retry with clean options
        if (
          provider === 'gemini' &&
          res.status === 400 &&
          payload.generationConfig?.thinkingConfig
        ) {
          const error = await res.clone().text();
          if (/thinking|includeThoughts/i.test(error)) {
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
          }
        }
        if (res.ok && res.body) {
          upstream = res;
          usedKeyIndex = i;
          break modelLoop;
        }
        lastStatus = res.status;
        const errText = await res.clone().text();
        await res.body?.cancel();

        // If model not found or not supported or rejected parameters, try next model candidate in chain
        if (
          provider === 'gemini' &&
          (res.status === 404 ||
            res.status === 400 ||
            /not found|not supported|invalid argument/i.test(errText))
        ) {
          console.warn(
            `[VisionOS] Model ${currentModel} not available (HTTP ${res.status}), trying fallback...`
          );
          break; // break key loop to advance to next candidate model
        }

        if (![401, 403, 429, 500, 502, 503, 504].includes(res.status)) break;
      }
    }
  } catch (error) {
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
  if (!upstream?.body)
    return Response.json(
      {
        error:
          lastStatus === 429
            ? 'The provider rate limit was reached. Retry shortly.'
            : `The provider rejected this request (${lastStatus}). Check the model ID and credentials.`,
      },
      { status: lastStatus >= 400 && lastStatus < 600 ? lastStatus : 502 }
    );
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
      let publicText = '';
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
        emit({ t: 'action', frame });
      };
      try {
        for await (const event of readSSE(input)) {
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
            if (
              candidate?.finishReason &&
              !['STOP', 'MAX_TOKENS', 'TOOL_CALLS'].includes(candidate.finishReason)
            )
              throw new Error(
                'The response was incomplete or blocked. Try a smaller request.'
              );
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
            if (['length', 'content_filter'].includes(choice?.finish_reason))
              throw new Error(
                'The response was incomplete or blocked. Try a smaller request.'
              );
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
        for (const entry of calls.values())
          emitTool(entry.name, JSON.parse(entry.args));
        emit({ t: 'done' });
      } catch (error) {
        emit({
          t: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The response could not be parsed. Please retry.',
        });
      } finally {
        if (!controller.signal.aborted) output.close();
      }
    },
    cancel() {
      controller.abort();
      void input.cancel().catch(() => {});
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Selected-Provider': provider,
      'X-Selected-Model': model,
      'X-Key-Index': String(usedKeyIndex),
    },
  });
}
