import type { NextRequest } from 'next/server';
import type {
  AISpatialChatRequest,
  AISpatialStreamRequest,
  AIMakeRealRequest,
  AIProvider,
} from '@/types/spatial';
const windows = new Map<string, { count: number; until: number }>();
const MAX_REQUEST_BYTES = 8_000_000;
const MAX_CONTEXT_CHARS = 350_000;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function invalid(message: string): never {
  throw new RequestValidationError(message);
}

function tooLarge(message = 'Request too large.'): never {
  throw new RequestBodyTooLargeError(message);
}

function assertString(
  value: unknown,
  label: string,
  maxLength: number,
  options: { optional: true; nonEmpty?: boolean }
): asserts value is string | undefined;
function assertString(
  value: unknown,
  label: string,
  maxLength: number,
  options?: { optional?: false; nonEmpty?: boolean }
): asserts value is string;
function assertString(
  value: unknown,
  label: string,
  maxLength: number,
  options: { optional?: boolean; nonEmpty?: boolean }
): asserts value is string | undefined;
function assertString(
  value: unknown,
  label: string,
  maxLength: number,
  options: { optional?: boolean; nonEmpty?: boolean } = {}
): asserts value is string | undefined {
  if (value === undefined && options.optional) return;
  if (typeof value !== 'string') invalid(`${label} must be a string.`);
  if (value.length > maxLength) tooLarge(`${label} is too large.`);
  if (options.nonEmpty && !value.trim()) invalid(`${label} cannot be empty.`);
}

function assertFiniteNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
  options: { optional?: boolean; integer?: boolean } = {}
): asserts value is number | undefined {
  if (value === undefined && options.optional) return;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (options.integer && !Number.isInteger(value))
  )
    invalid(`${label} is invalid.`);
}

function assertBoolean(
  value: unknown,
  label: string,
  optional = true
): asserts value is boolean | undefined {
  if (value === undefined && optional) return;
  if (typeof value !== 'boolean') invalid(`${label} must be a boolean.`);
}

function assertArray(
  value: unknown,
  label: string,
  maxLength: number,
  options: { optional: true; minLength?: number }
): asserts value is unknown[] | undefined;
function assertArray(
  value: unknown,
  label: string,
  maxLength: number,
  options?: { optional?: false; minLength?: number }
): asserts value is unknown[];
function assertArray(
  value: unknown,
  label: string,
  maxLength: number,
  options: { optional?: boolean; minLength?: number }
): asserts value is unknown[] | undefined;
function assertArray(
  value: unknown,
  label: string,
  maxLength: number,
  options: { optional?: boolean; minLength?: number } = {}
): asserts value is unknown[] | undefined {
  if (value === undefined && options.optional) return;
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  if (value.length > maxLength) tooLarge(`${label} has too many items.`);
  if (value.length < (options.minLength || 0)) invalid(`${label} is empty.`);
}

function assertProviderAndModel(body: JsonRecord): void {
  if (
    body.provider !== undefined &&
    body.provider !== 'gemini' &&
    body.provider !== 'openrouter' &&
    body.provider !== 'openai'
  )
    invalid('Unsupported provider.');
  if (body.model !== undefined) {
    assertString(body.model, 'Model identifier', 160, { nonEmpty: true });
    if (!/^[\w./:-]{1,160}$/.test(body.model))
      invalid('Invalid model identifier.');
  }
}

function assertCredentialFields(body: JsonRecord): void {
  if ('chatgptOAuthToken' in body)
    invalid('ChatGPT OAuth credentials are not supported. Use a provider API key.');

  const assertApiCredential = (value: string, field: string) => {
    if (value.trim().toLowerCase().startsWith('chatgpt_sub_'))
      invalid(`${field} is not a provider API key.`);
  };

  for (const field of ['apiKey', 'openRouterApiKey', 'openaiApiKey']) {
    const value = body[field];
    if (value !== undefined) {
      assertString(value, field, 512);
      if (value.length > 0 && value.length < 8)
        invalid(`${field} is invalid.`);
      assertApiCredential(value, field);
    }
  }
  for (const field of ['apiKeys', 'openRouterApiKeys', 'openaiApiKeys']) {
    const value = body[field];
    if (value !== undefined) {
      // The UI accepts multiple saved keys; providerKeys uses at most five.
      assertArray(value, field, 50);
      for (const key of value) {
        assertString(key, `${field} entry`, 512, { nonEmpty: true });
        if (key.length < 8) invalid(`${field} contains an invalid key.`);
        assertApiCredential(key, `${field} entry`);
      }
    }
  }
}

function assertProviderFields(body: JsonRecord): void {
  assertProviderAndModel(body);
  assertCredentialFields(body);
}

/** Bound the alternate credential headers consumed by providerKeys. */
export function validateProviderHeaders(req: Request, provider: AIProvider): void {
  const singleName =
    provider === 'openrouter'
      ? 'x-openrouter-api-key'
      : provider === 'openai'
        ? 'x-openai-api-key'
        : 'x-gemini-api-key';
  const multipleName =
    provider === 'openrouter'
      ? 'x-openrouter-api-keys'
      : provider === 'openai'
        ? 'x-openai-api-keys'
        : 'x-gemini-api-keys';
  const single = req.headers.get(singleName);
  if (single !== null) {
    assertString(single, singleName, 512);
    if (single.length > 0 && single.length < 8) invalid(`${singleName} is invalid.`);
    if (single.trim().toLowerCase().startsWith('chatgpt_sub_'))
      invalid(`${singleName} is not a provider API key.`);
  }
  const multiple = req.headers.get(multipleName);
  if (multiple === null) return;
  assertString(multiple, multipleName, 26_000);
  if (!multiple.trim()) return;
  let entries: unknown[];
  try {
    const parsed: unknown = JSON.parse(multiple);
    entries = Array.isArray(parsed) ? parsed : multiple.split(/[\n,;]+/);
  } catch {
    entries = multiple.split(/[\n,;]+/);
  }
  assertArray(entries, multipleName, 50);
  for (const entry of entries) {
    assertString(entry, `${multipleName} entry`, 512, { nonEmpty: true });
    if (entry.trim().length < 8) invalid(`${multipleName} contains an invalid key.`);
    if (entry.trim().toLowerCase().startsWith('chatgpt_sub_'))
      invalid(`${multipleName} contains a non-API credential.`);
  }
}

function assertPoint(value: unknown, label: string): void {
  if (!isRecord(value)) invalid(`${label} is invalid.`);
  assertFiniteNumber(value.x, `${label}.x`, -1_000_000_000, 1_000_000_000);
  assertFiniteNumber(value.y, `${label}.y`, -1_000_000_000, 1_000_000_000);
}

function assertBounds(value: unknown, label: string): void {
  if (!isRecord(value)) invalid(`${label} is invalid.`);
  for (const key of ['x', 'y'])
    assertFiniteNumber(value[key], `${label}.${key}`, -1_000_000_000, 1_000_000_000);
  for (const key of ['w', 'h'])
    assertFiniteNumber(value[key], `${label}.${key}`, 0, 100_000_000);
}

function assertStringList(
  value: unknown,
  label: string,
  maxItems: number,
  maxStringLength: number,
  options: { optional?: boolean } = {}
): asserts value is string[] | undefined {
  assertArray(value, label, maxItems, options);
  if (value === undefined) return;
  for (const item of value) {
    assertString(item, `${label} entry`, maxStringLength, { nonEmpty: true });
  }
}

function assertStorage(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) invalid(`${label} must be an object.`);
  const entries = Object.entries(value);
  if (entries.length > 500) tooLarge(`${label} has too many entries.`);
  let totalLength = 0;
  for (const [key, content] of entries) {
    assertString(key, `${label} key`, 512, { nonEmpty: true });
    assertString(content, `${label} value`, 1_000_000);
    totalLength += key.length + content.length;
  }
  if (totalLength > 1_000_000) tooLarge(`${label} is too large.`);
}

function assertSections(value: unknown, label: string): void {
  if (value === undefined) return;
  assertArray(value, label, 100);
  let totalLength = 0;
  for (const section of value) {
    if (!isRecord(section)) invalid(`${label} contains an invalid section.`);
    assertString(section.id, `${label} section id`, 256, { nonEmpty: true });
    assertString(section.title, `${label} section title`, 2_000);
    assertString(section.content, `${label} section content`, 180_000);
    assertString(section.badge, `${label} section badge`, 256, { optional: true });
    totalLength +=
      section.id.length + section.title.length + section.content.length +
      (typeof section.badge === 'string' ? section.badge.length : 0);
  }
  if (totalLength > 180_000) tooLarge(`${label} is too large.`);
}

function assertSlideList(value: unknown, label: string): void {
  if (value === undefined) return;
  assertArray(value, label, 100);
  let totalLength = 0;
  for (const slide of value) {
    if (!isRecord(slide)) invalid(`${label} contains an invalid slide.`);
    assertString(slide.id, `${label} slide id`, 256, { optional: true });
    assertString(slide.title, `${label} slide title`, 4_000, { optional: true });
    assertString(slide.subtitle, `${label} slide subtitle`, 4_000, { optional: true });
    assertString(slide.layout, `${label} slide layout`, 128, { optional: true });
    assertString(slide.content, `${label} slide content`, 30_000, { optional: true });
    assertString(slide.speakerNotes, `${label} speaker notes`, 10_000, { optional: true });
    assertStringList(slide.bullets, `${label} bullets`, 100, 4_000, { optional: true });

    for (const [field, maxItems] of [['stats', 50], ['columns', 20], ['timelineSteps', 50]] as const) {
      const items: unknown = slide[field];
      if (items === undefined) continue;
      assertArray(items, `${label} ${field}`, maxItems);
      for (const item of items) {
        if (!isRecord(item)) invalid(`${label} ${field} contains an invalid item.`);
        const allowedFields =
          field === 'stats'
            ? ['label', 'value', 'change']
            : field === 'columns'
              ? ['title', 'text', 'icon']
              : ['step', 'title', 'desc'];
        for (const itemField of allowedFields)
          assertString(item[itemField], `${label} ${field}.${itemField}`, 4_000, {
            optional: item[itemField] === undefined,
          });
      }
    }
    totalLength += JSON.stringify(slide).length;
  }
  if (totalLength > 180_000) tooLarge(`${label} is too large.`);
}

function assertNode(value: unknown, label: string, requireGeometry: boolean): void {
  if (!isRecord(value)) invalid(`${label} is invalid.`);
  assertString(value.id, `${label}.id`, 256, { nonEmpty: true });
  assertString(value.type, `${label}.type`, 64, { nonEmpty: true });

  const geometryFields = ['minX', 'minY', 'maxX', 'maxY'];
  if (requireGeometry || geometryFields.some((field) => value[field] !== undefined)) {
    for (const field of geometryFields)
      assertFiniteNumber(value[field], `${label}.${field}`, -1_000_000_000, 1_000_000_000);
    if ((value.maxX as number) < (value.minX as number) || (value.maxY as number) < (value.minY as number))
      invalid(`${label} geometry is invalid.`);
    if ((value.maxX as number) - (value.minX as number) > 100_000_000 || (value.maxY as number) - (value.minY as number) > 100_000_000)
      tooLarge(`${label} geometry is too large.`);
  }

  const strings: Array<[string, number]> = [
    ['parentId', 256], ['title', 2_000], ['subtitle', 4_000], ['author', 500],
    ['date', 128], ['text', 180_000], ['content', 180_000], ['code', 180_000],
    ['language', 128], ['description', 16_000], ['mediaUrl', 2_048],
    ['svgPath', 30_000], ['color', 128], ['from', 256], ['to', 256], ['label', 1_000],
    ['theme', 1_000_000], ['canvaEmbedUrl', 1_000_000],
  ];
  for (const [field, max] of strings)
    assertString(value[field], `${label}.${field}`, max, { optional: true });

  if (value.archetype !== undefined && !['idea', 'note', 'research', 'comparison', 'prompt'].includes(String(value.archetype)))
    invalid(`${label}.archetype is invalid.`);
  if (value.mediaType !== undefined && !['youtube', 'web', 'audio'].includes(String(value.mediaType)))
    invalid(`${label}.mediaType is invalid.`);
  if (value.vectorType !== undefined && !['database', 'cloud', 'decision', 'service', 'queue', 'custom'].includes(String(value.vectorType)))
    invalid(`${label}.vectorType is invalid.`);
  assertFiniteNumber(value.zIndex, `${label}.zIndex`, 0, 1_000_000, { optional: true, integer: true });
  assertFiniteNumber(value.rotation, `${label}.rotation`, -10_000, 10_000, { optional: true });
  assertFiniteNumber(value.intrinsicW, `${label}.intrinsicW`, 0, 100_000_000, { optional: true });
  assertFiniteNumber(value.intrinsicH, `${label}.intrinsicH`, 0, 100_000_000, { optional: true });
  assertFiniteNumber(value.currentSlideIndex, `${label}.currentSlideIndex`, 0, 499, { optional: true, integer: true });
  assertFiniteNumber(value.slideCount, `${label}.slideCount`, 0, 500, { optional: true, integer: true });
  assertBoolean(value.isLocked, `${label}.isLocked`);

  assertStorage(value.storage, `${label}.storage`);
  assertSections(value.sections, `${label}.sections`);
  assertSlideList(value.slides, `${label}.slides`);
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) invalid(`${label}.metadata must be an object.`);
    const entries = Object.entries(value.metadata);
    if (entries.length > 32) tooLarge(`${label}.metadata has too many entries.`);
    for (const [key, metadataValue] of entries) {
      assertString(key, `${label}.metadata key`, 128, { nonEmpty: true });
      if (typeof metadataValue === 'string')
        assertString(metadataValue, `${label}.metadata value`, 256);
      else if (typeof metadataValue === 'number')
        assertFiniteNumber(metadataValue, `${label}.metadata value`, -1_000_000, 1_000_000);
      else if (typeof metadataValue !== 'boolean' && metadataValue !== null)
        invalid(`${label}.metadata values must be primitive.`);
    }
  }
}

function assertCulledContext(value: unknown, selectedLimit = 300): asserts value is AISpatialChatRequest['culledContext'] {
  if (!isRecord(value)) invalid('Canvas context is required.');
  assertArray(value.selectedNodes, 'Selected nodes', selectedLimit);
  assertArray(value.viewportNeighbors, 'Viewport neighbors', 100);
  assertArray(value.macroClusters, 'Canvas clusters', 100);
  const selectedNodes = value.selectedNodes as unknown[];
  const viewportNeighbors = value.viewportNeighbors as unknown[];
  const macroClusters = value.macroClusters as unknown[];
  for (const node of selectedNodes) assertNode(node, 'Selected node', true);
  for (const node of viewportNeighbors) assertNode(node, 'Nearby node', true);
  if (value.boardIndex !== undefined) {
    assertArray(value.boardIndex, 'Board index', 300);
    for (const node of value.boardIndex as unknown[]) assertNode(node, 'Board index node', true);
  }
  for (const cluster of macroClusters) {
    if (!isRecord(cluster)) invalid('Canvas cluster is invalid.');
    assertString(cluster.id, 'Canvas cluster id', 256, { nonEmpty: true });
    assertString(cluster.label, 'Canvas cluster label', 500, { optional: true });
    assertBounds(cluster.bounds, 'Canvas cluster bounds');
    assertFiniteNumber(cluster.childCount, 'Canvas cluster child count', 0, 1_000_000, { integer: true });
  }
  assertFiniteNumber(value.totalTokenEstimate, 'Token estimate', 0, 10_000_000);
  if (value.recentChanges !== undefined)
    assertStringList(value.recentChanges, 'Recent changes', 60, 300, { optional: true });
  const serialized = safeJsonLength(value);
  if (serialized > MAX_CONTEXT_CHARS) tooLarge('Canvas context is too large. Select fewer objects.');
}

function safeJsonLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) invalid('Invalid request.');
    return serialized.length;
  } catch {
    invalid('Invalid request.');
  }
}

export class RequestBodyTooLargeError extends Error {
  constructor(message = 'Request too large.') {
    super(message);
    this.name = 'RequestBodyTooLargeError';
  }
}

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

/** Read JSON with a hard streaming byte limit, including requests without Content-Length. */
export async function readBoundedJson<T = unknown>(
  req: Request,
  maxBytes = MAX_REQUEST_BYTES
): Promise<T> {
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes)
    throw new RequestBodyTooLargeError();
  if (!req.body) throw new Error('Invalid JSON request.');

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Invalid JSON request.');
  }
}

/** Rejects malformed or unbounded Make Real inputs before credentials/provider work. */
export function validateMakeRealRequest(body: unknown): asserts body is AIMakeRealRequest {
  if (!isRecord(body)) invalid('Invalid or oversized generation request.');
  assertProviderFields(body);
  assertString(body.prompt, 'Prompt', 16_000, { optional: true });
  assertString(body.existingCode, 'Existing source', 180_000, { optional: true });
  assertString(body.image, 'Screenshot', 7_000_000, { optional: true });
  assertString(body.mimeType, 'Screenshot MIME type', 64, { optional: true });
  if (body.mimeType !== undefined && !['image/png', 'image/jpeg', 'image/webp'].includes(String(body.mimeType)))
    invalid('Screenshot MIME type is invalid.');

  if (body.image !== undefined) {
    const dataUrl = body.image.match(/^data:([^;,]+);base64,(.*)$/s);
    const base64 = dataUrl ? dataUrl[2] : body.image;
    const mimeType = dataUrl ? dataUrl[1] : body.mimeType || 'image/png';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(mimeType)) ||
      base64.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
      invalid('Screenshot data is invalid.');
  }

  if (body.selectedShapesContext !== undefined) {
    assertArray(body.selectedShapesContext, 'Selected shape context', 300, { optional: true });
    let totalLength = 0;
    for (const shape of body.selectedShapesContext) {
      if (!isRecord(shape)) invalid('Selected shape context is invalid.');
      assertString(shape.id, 'Selected shape id', 256, { nonEmpty: true });
      assertString(shape.type, 'Selected shape type', 64, { nonEmpty: true });
      for (const [field, max] of [
        ['title', 2_000], ['text', 180_000], ['content', 180_000], ['code', 180_000],
        ['language', 128], ['archetype', 128], ['color', 128],
      ] as const)
        assertString(shape[field], `Selected shape ${field}`, max, { optional: true });
      totalLength += safeJsonLength(shape);
      assertStorage(shape.storage, 'Selected shape storage');
      assertSections(shape.sections, 'Selected shape sections');
      assertSlideList(shape.slides, 'Selected shape slides');
    }
    if (totalLength > 300_000) tooLarge('Selected shape context is too large.');
  }
  if (!body.image && !body.existingCode)
    invalid('Image data is required unless existing source is provided.');
  if (safeJsonLength(body) > MAX_REQUEST_BYTES) tooLarge();
}

/** Runtime schema for the chat and Swarm routes; the assertion follows full validation. */
export function validateChatRequest(body: unknown): asserts body is AISpatialChatRequest {
  if (!isRecord(body)) invalid('Invalid chat request.');
  assertProviderFields(body);
  assertArray(body.messages, 'Conversation', 60, { minLength: 1 });
  let messageLength = 0;
  for (const message of body.messages as unknown[]) {
    if (!isRecord(message)) invalid('Conversation contains an invalid message.');
    if (!['user', 'assistant', 'system'].includes(String(message.role)))
      invalid('Conversation contains an invalid role.');
    assertString(message.content, 'Message content', 60_000);
    messageLength += message.content.length;
  }
  if (messageLength > 200_000) tooLarge('Conversation is too large.');
  assertCulledContext(body.culledContext);

  if (body.viewportCenter !== undefined) assertPoint(body.viewportCenter, 'Viewport center');
  assertBoolean(body.thinkingMode, 'Thinking mode');
  assertBoolean(body.swarmMode, 'Swarm mode');
  assertBoolean(body.isMakeReal, 'Make Real flag');
  if (body.interactionMode !== undefined && !['auto', 'chat_only', 'canvas'].includes(String(body.interactionMode)))
    invalid('Interaction mode is invalid.');
  if (body.temperature !== undefined)
    assertFiniteNumber(body.temperature, 'Temperature', 0, 1);

  if (body.recentEntities !== undefined) {
    assertArray(body.recentEntities, 'Recent entities', 100);
    for (const entity of body.recentEntities as unknown[]) {
      if (!isRecord(entity)) invalid('Recent canvas context is invalid.');
      assertString(entity.id, 'Recent entity id', 256, { nonEmpty: true });
      assertString(entity.type, 'Recent entity type', 64, { nonEmpty: true });
      assertString(entity.title, 'Recent entity title', 2_000, { optional: true });
      assertString(entity.summary, 'Recent entity summary', 4_000, { optional: true });
    }
  }
  if (body.viewportInfo !== undefined) {
    if (!isRecord(body.viewportInfo)) invalid('Viewport information is invalid.');
    assertFiniteNumber(body.viewportInfo.zoom, 'Viewport zoom', 0.0001, 1_000);
    assertPoint(body.viewportInfo.center, 'Viewport information center');
    assertFiniteNumber(body.viewportInfo.visibleShapeCount, 'Visible shape count', 0, 1_000_000, { integer: true });
    if (body.viewportInfo.bounds !== undefined) assertBounds(body.viewportInfo.bounds, 'Viewport bounds');
  }
  if (body.visualSnapshot !== undefined) {
    if (!isRecord(body.visualSnapshot)) invalid('Canvas image is invalid or too large.');
    const snapshot = body.visualSnapshot;
    assertString(snapshot.mimeType, 'Canvas image MIME type', 32, { nonEmpty: true });
    assertString(snapshot.base64, 'Canvas image data', 7_000_000, { nonEmpty: true });
    const base64 = (snapshot.base64 as string).replace(/^data:[^;]+;base64,/, '');
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(String(snapshot.mimeType)) ||
      base64.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    ) invalid('Canvas image is invalid or too large.');
    assertString(snapshot.dataUrl, 'Canvas image data URL', 7_000_000, { optional: true });
    if (snapshot.width !== undefined) assertFiniteNumber(snapshot.width, 'Canvas image width', 1, 16_384, { integer: true });
    if (snapshot.height !== undefined) assertFiniteNumber(snapshot.height, 'Canvas image height', 1, 16_384, { integer: true });
  }
  if (safeJsonLength(body) > MAX_REQUEST_BYTES) tooLarge();
}

/** Runtime schema for the local deterministic spatial stream endpoint. */
export function validateSpatialStreamRequest(body: unknown): asserts body is AISpatialStreamRequest {
  if (!isRecord(body)) invalid('Invalid spatial stream request.');
  assertProviderFields(body);
  if (!['organize', 'connect', 'simulate', 'custom', 'chat'].includes(String(body.intent)))
    invalid('Invalid spatial stream request.');
  assertString(body.prompt, 'Prompt', 16_000, { optional: true });
  if (!isRecord(body.culledContext)) invalid('Invalid spatial stream request.');
  assertArray(body.culledContext.selectedNodes, 'Selected nodes', 100);
  for (const node of body.culledContext.selectedNodes as unknown[]) {
    assertNode(node, 'Selected node', false);
    if (!isRecord(node)) invalid('Selected node is invalid.');
    for (const field of ['x', 'y'])
      assertFiniteNumber(node[field], `Selected node ${field}`, -1_000_000_000, 1_000_000_000, { optional: true });
    for (const field of ['w', 'h'])
      assertFiniteNumber(node[field], `Selected node ${field}`, 0, 100_000_000, { optional: true });
  }
  if (body.viewportCenter !== undefined) assertPoint(body.viewportCenter, 'Viewport center');
  if (safeJsonLength(body) > MAX_REQUEST_BYTES) tooLarge();
}

/** Same-origin/rate defense for the current test deployment; this is not user authentication. */
export function guardRequest(req: NextRequest): Response | null {
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (
        new URL(origin).host !== (req.headers.get('host') || req.nextUrl.host)
      )
        return Response.json(
          { error: 'Cross-origin AI requests are not allowed.' },
          { status: 403 }
        );
    } catch {
      return Response.json(
        { error: 'Invalid request origin.' },
        { status: 400 }
      );
    }
  }
  if (Number(req.headers.get('content-length') || 0) > MAX_REQUEST_BYTES)
    return Response.json({ error: 'Request too large.' }, { status: 413 });
  const id = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
  const now = Date.now();
  if (windows.size > 2000)
    for (const [key, w] of windows) if (w.until < now) windows.delete(key);
  const w = windows.get(id);
  if (w && w.until > now && w.count >= 20)
    return Response.json(
      { error: 'Too many AI requests. Please wait a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  windows.set(
    id,
    w && w.until > now
      ? { ...w, count: w.count + 1 }
      : { count: 1, until: now + 60000 }
  );
  return null;
}
export function createProviderSignal(req: NextRequest) {
  const controller = new AbortController();
  const abort = () => controller.abort(req.signal.reason);
  if (req.signal.aborted) {
    abort();
    return {
      signal: controller.signal,
      abort: (reason?: unknown) => controller.abort(reason),
      dispose: () => {},
    };
  }
  req.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('Provider timed out.')),
    150000
  );
  // Node timer must not keep the server alive after shutdown.
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  const cleanup = () => {
    clearTimeout(timer);
    req.signal.removeEventListener('abort', abort);
  };
  controller.signal.addEventListener(
    'abort',
    cleanup,
    { once: true }
  );
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    dispose: () => {
      cleanup();
      controller.signal.removeEventListener('abort', cleanup);
    },
  };
}

/** Backward-compatible signal helper used by the excluded Swarm route. */
export function providerSignal(req: NextRequest) {
  return createProviderSignal(req).signal;
}
