import { NextRequest } from 'next/server';
import { POST as chat } from '../chat/route';
import { providerKeys } from '@/lib/ai/provider';
import {
  guardRequest,
  providerSignal,
  validateChatRequest,
} from '@/lib/ai/request';
import { SWARM_PLANNER_PROMPT } from '@/lib/ai/prompts';
import { buildSpatialContextText } from '@/lib/ai/prompt';
import { validateAction, shapeId } from '@/lib/ai/actions';
import type { AISpatialChatRequest, SpatialActionFrame } from '@/types/spatial';

export const runtime = 'nodejs';

/** Workers share the standard validated action pipeline. No placeholder success paths. */
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
        error: `${provider === 'gemini' ? 'Gemini' : 'OpenRouter'} API Key is required. Configure a server key or add your key in settings.`,
      },
      { status: 401 }
    );
  const signal = providerSignal(req);
  const internalRequest = (payload: AISpatialChatRequest) =>
    new NextRequest(new URL('/api/ai/chat', req.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        ...(provider === 'gemini'
          ? { apiKeys: keys }
          : { openRouterApiKeys: keys }),
      }),
      signal,
    });
  // Existing-object edits remain one coherent transaction, with all selected source intact.
  if (
    body.culledContext.selectedNodes.length ||
    body.interactionMode === 'chat_only'
  )
    return chat(internalRequest(body));
  const model =
    body.model ||
    (provider === 'gemini'
      ? process.env.GEMINI_MODEL || 'gemini'
      : process.env.OPENROUTER_MODEL || 'openai/gpt-4o');
  const userRequest =
    body.messages.filter((m) => m.role === 'user').at(-1)?.content || '';
  const plannerInput = `User request:\n${userRequest}\n\nCanvas snapshot (untrusted reference):\n${buildSpatialContextText(body)}`;
  const plannerPayload =
    provider === 'gemini'
      ? {
          systemInstruction: { parts: [{ text: SWARM_PLANNER_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: plannerInput }] }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
          },
        }
      : {
          model,
          messages: [
            { role: 'system', content: SWARM_PLANNER_PROMPT },
            { role: 'user', content: plannerInput },
          ],
          temperature: 0.15,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
        };
  let plan: {
    mode: 'single' | 'parallel';
    tasks: Array<{ title: string; prompt: string }>;
  };
  try {
    let response: Response | undefined;
    for (const key of keys) {
      const headers: Record<string, string> =
        provider === 'gemini'
          ? { 'Content-Type': 'application/json', 'x-goog-api-key': key }
          : {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${key}`,
            };
      response = await fetch(
        provider === 'gemini'
          ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
          : 'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(plannerPayload),
          signal,
        }
      );
      if (response.ok) break;
      if (![401, 403, 429, 500, 502, 503, 504].includes(response.status)) break;
      await response.body?.cancel();
    }
    if (!response?.ok)
      throw new Error(
        `Swarm planning failed (${response?.status || 502}). Check the provider settings or retry.`
      );
    const data = await response.json();
    const raw =
      provider === 'gemini'
        ? data.candidates?.[0]?.content?.parts
            ?.filter((p: any) => p.text && !p.thought)
            .map((p: any) => p.text)
            .join('')
        : data.choices?.[0]?.message?.content;
    plan = JSON.parse(
      String(raw || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
    );
    if (
      !plan ||
      !['single', 'parallel'].includes(plan.mode) ||
      !Array.isArray(plan.tasks)
    )
      throw new Error('Invalid swarm plan. Please retry.');
    if (
      plan.mode === 'parallel' &&
      (plan.tasks.length < 2 ||
        plan.tasks.length > 4 ||
        plan.tasks.some(
          (t) =>
            !t ||
            typeof t.title !== 'string' ||
            t.title.length > 120 ||
            typeof t.prompt !== 'string' ||
            !t.prompt.trim() ||
            t.prompt.length > 12000
        ))
    )
      throw new Error('Invalid specialist tasks. Please retry.');
  } catch (error) {
    return Response.json(
      {
        error: signal.aborted
          ? 'Swarm planning stopped or timed out.'
          : error instanceof Error
            ? error.message
            : 'Swarm planning failed. Please retry.',
      },
      { status: 502 }
    );
  }
  if (plan.mode === 'single') return chat(internalRequest(body));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      try {
        emit({
          t: 'text',
          chunk: `Working with ${plan.tasks.length} specialists: ${plan.tasks.map((t) => t.title).join(', ')}.\n\n`,
        });
        const results = await Promise.all(
          plan.tasks.map(async (task, index) => {
            const workerBody: AISpatialChatRequest = {
              ...body,
              swarmMode: false,
              messages: [
                ...body.messages.slice(0, -1),
                {
                  role: 'user',
                  content: `Original request:\n${userRequest}\n\nYour independent assignment: ${task.title}\n${task.prompt}\nCreate only your assigned elements. Do not edit or delete existing canvas elements. Other specialists handle the rest.`,
                },
              ],
            };
            const response = await chat(internalRequest(workerBody));
            if (!response.ok) {
              const data = await response.json().catch(() => null);
              throw new Error(
                `${task.title}: ${data?.error || 'specialist failed'}`
              );
            }
            const text = await response.text();
            if (text.length > 1500000)
              throw new Error(`${task.title}: response exceeded the limit.`);
            const events = text
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line));
            const failure = events.find((e) => e.t === 'error');
            if (failure || !events.some((e) => e.t === 'done'))
              throw new Error(
                `${task.title}: ${failure?.message || 'incomplete response'}`
              );
            const frames = events
              .filter((e) => e.t === 'action')
              .map((e) => validateAction(e.frame));
            if (!frames.length)
              throw new Error(
                `${task.title} returned no canvas actions. Please retry.`
              );
            const allowed = new Set([
              'create_card',
              'create_rich_card',
              'create_code_card',
              'spawn_artifact',
              'embed_media',
              'draw_vector',
              'create_document',
              'create_group',
              'connect',
              'focus_viewport',
            ]);
            if (frames.some((f) => !allowed.has(f.op)))
              throw new Error(
                `${task.title} attempted a dependent edit. Retry as one assistant task.`
              );
            const ids = new Map(
              frames
                .filter((f) => f.id)
                .map((f) => [shapeId(f.id!), `swarm_${crypto.randomUUID()}`])
            );
            const remap = (id: string) => ids.get(shapeId(id)) || id;
            for (const f of frames) {
              if (f.id) f.id = remap(f.id);
              if (f.from) f.from = remap(f.from);
              if (f.to) f.to = remap(f.to);
              if (f.nodeIds) f.nodeIds = f.nodeIds.map(remap);
              if (f.relative)
                f.relative = f.relative.replace(
                  /^(right_of|left_of|above|below|next_to):(.+)$/,
                  (_m, relation, id) => `${relation}:${remap(id)}`
                );
              // A single shared layout session places independent workers consecutively.
              if (f.relative === 'center') delete f.relative;
            }
            return {
              frames,
              text: events
                .filter((e) => e.t === 'text')
                .map((e) => e.chunk)
                .join(''),
              index,
            };
          })
        );
        signal.throwIfAborted();
        const frames = results.flatMap((result) => result.frames);
        if (frames.length > 100)
          throw new Error(
            'The swarm produced too many actions. Use a smaller request.'
          );
        for (const frame of frames) emit({ t: 'action', frame });
        const summary = results
          .map((result) => result.text.trim())
          .filter(Boolean)
          .join('\n\n');
        emit({
          t: 'text',
          chunk:
            summary || 'The specialist results are ready to apply together.',
        });
        emit({ t: 'done' });
      } catch (error) {
        emit({
          t: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Swarm failed. No pending changes were applied.',
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
