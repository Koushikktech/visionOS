import type { SpatialActionFrame } from '@/types/spatial';

const operations = new Set([
  'speculative_skeleton',
  'create_card',
  'create_rich_card',
  'create_code_card',
  'stream_card_patch',
  'create_group',
  'spawn_artifact',
  'embed_media',
  'draw_vector',
  'create_document',
  'mutate_document',
  'mutate_artifact',
  'mutate_rich_card',
  'mutate_code_card',
  'mutate_media',
  'mutate_vector',
  'connect',
  'align',
  'dock_into',
  'repel_colliding',
  'mutate_text',
  'restyle_shape',
  'delete_shape',
  'focus_viewport',
  'move_shape',
  'resize_shape',
]);
const colors = new Set([
  'black',
  'grey',
  'light-violet',
  'violet',
  'blue',
  'light-blue',
  'yellow',
  'orange',
  'green',
  'light-green',
  'light-red',
  'red',
  'white',
]);
export const shapeId = (id: string) =>
  id.startsWith('shape:') ? id : `shape:${id}`;

/** Runtime validation is mandatory even when the provider uses native tool schemas. */
export function validateAction(value: unknown): SpatialActionFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid canvas action.');
  const f = value as SpatialActionFrame;
  if (f.t !== 'patch' || !operations.has(f.op))
    throw new Error('Unsupported canvas action.');
  const fields = new Set([
    't',
    'op',
    'id',
    'target',
    'anchor',
    'group',
    'from',
    'to',
    'title',
    'label',
    'slot',
    'direction',
    'relative',
    'margin',
    'text',
    'content',
    'archetype',
    'tags',
    'code',
    'language',
    'description',
    'storage',
    'initialStorage',
    'mediaUrl',
    'mediaType',
    'vectorType',
    'svgPath',
    'color',
    'shapeType',
    'subtitle',
    'author',
    'date',
    'sections',
    'nodeIds',
    'bend',
    'w',
    'h',
    'x',
    'y',
    'fill',
    'bounds',
  ]);
  for (const [key, val] of Object.entries(f)) {
    if (!fields.has(key)) throw new Error(`Unsupported action field: ${key}.`);
    if (
      [
        'title',
        'label',
        'text',
        'content',
        'code',
        'language',
        'description',
        'subtitle',
        'author',
        'date',
        'svgPath',
        'relative',
      ].includes(key) &&
      typeof val !== 'string'
    )
      throw new Error(`Invalid ${key}.`);
    if (typeof val === 'string' && val.length > 300_000)
      throw new Error(`Action ${key} is too large.`);
    if (
      ['w', 'h', 'x', 'y', 'margin', 'bend'].includes(key) &&
      (typeof val !== 'number' ||
        !Number.isFinite(val) ||
        Math.abs(val) > 1000000)
    )
      throw new Error(`Invalid ${key}.`);
  }
  for (const key of [
    'id',
    'target',
    'from',
    'to',
    'anchor',
    'group',
  ] as const) {
    if (
      f[key] !== undefined &&
      (typeof f[key] !== 'string' || !/^[\w:.-]{1,160}$/.test(f[key]!))
    )
      throw new Error(`Invalid ${key}.`);
  }
  if (
    f.bounds &&
    (!['x', 'y', 'w', 'h'].every((k) =>
      Number.isFinite((f.bounds as any)[k])
    ) ||
      f.bounds.w <= 0 ||
      f.bounds.h <= 0)
  )
    throw new Error('Invalid action bounds.');
  if (
    (f.w !== undefined && (f.w < 40 || f.w > 4000)) ||
    (f.h !== undefined && (f.h < 40 || f.h > 4000))
  )
    throw new Error('Invalid shape dimensions.');
  if (f.color !== undefined && !colors.has(f.color))
    throw new Error('Unsupported shape color.');
  if (
    f.fill !== undefined &&
    !['none', 'semi', 'solid', 'pattern'].includes(f.fill)
  )
    throw new Error('Unsupported fill.');
  if (
    f.direction !== undefined &&
    !['horizontal', 'vertical', 'grid'].includes(f.direction)
  )
    throw new Error('Invalid alignment.');
  if (
    f.archetype !== undefined &&
    !['idea', 'note', 'research', 'comparison', 'prompt'].includes(f.archetype)
  )
    throw new Error('Invalid card archetype.');
  if (
    f.nodeIds !== undefined &&
    (!Array.isArray(f.nodeIds) ||
      !f.nodeIds.length ||
      f.nodeIds.length > 200 ||
      !f.nodeIds.every(
        (id) => typeof id === 'string' && /^[\w:.-]{1,160}$/.test(id)
      ))
  )
    throw new Error('Invalid shape selection.');
  if (
    (f.op.startsWith('mutate_') ||
      ['restyle_shape', 'move_shape', 'resize_shape'].includes(f.op)) &&
    !f.target
  )
    throw new Error(`${f.op} needs an exact target.`);
  if (
    ['align', 'delete_shape', 'focus_viewport', 'create_group'].includes(
      f.op
    ) &&
    !f.nodeIds?.length
  )
    throw new Error(`${f.op} needs shape IDs.`);
  if (f.op === 'connect' && (!f.from || !f.to || f.from === f.to))
    throw new Error('A connector needs two different targets.');
  if (
    ['spawn_artifact', 'create_code_card'].includes(f.op) &&
    (typeof f.code !== 'string' || !f.code.trim())
  )
    throw new Error('Generated source is empty.');
  if (
    f.op === 'mutate_artifact' &&
    (typeof f.code !== 'string' || !f.code.trim())
  )
    throw new Error('Regeneration requires complete source.');
  if (['create_rich_card'].includes(f.op) && typeof f.content !== 'string')
    throw new Error('Missing card content.');
  if (
    f.sections !== undefined &&
    (!Array.isArray(f.sections) ||
      f.sections.length > 100 ||
      !f.sections.every(
        (s) =>
          s &&
          typeof s.id === 'string' &&
          typeof s.title === 'string' &&
          typeof s.content === 'string'
      ))
  )
    throw new Error('Invalid document sections.');
  if (
    f.storage !== undefined &&
    (!f.storage ||
      typeof f.storage !== 'object' ||
      Object.values(f.storage).some((v) => typeof v !== 'string') ||
      JSON.stringify(f.storage).length > 1000000)
  )
    throw new Error('Invalid app storage.');
  if (f.mediaType && !['web', 'youtube', 'audio'].includes(f.mediaType))
    throw new Error('Invalid media type.');
  if (
    f.vectorType &&
    !['database', 'cloud', 'decision', 'service', 'queue', 'custom'].includes(
      f.vectorType
    )
  )
    throw new Error('Invalid vector type.');
  if (f.op === 'embed_media' && !f.mediaUrl)
    throw new Error('A media URL is required.');
  if (f.mediaUrl) {
    const u = new URL(f.mediaUrl);
    if (!['https:', 'http:'].includes(u.protocol))
      throw new Error('Unsupported media URL.');
  }
  if (f.op === 'move_shape' && (!Number.isFinite(f.x) || !Number.isFinite(f.y)))
    throw new Error('Move requires coordinates.');
  if (f.op === 'resize_shape' && (!f.w || !f.h))
    throw new Error('Resize requires dimensions.');
  return f;
}

export function assertCompleteHtml(code: unknown): asserts code is string {
  if (
    typeof code !== 'string' ||
    code.length > 300000 ||
    !/^\s*(?:<!doctype html[^>]*>\s*)?<html[\s>]/i.test(code) ||
    !/<\/html>\s*$/i.test(code)
  )
    throw new Error(
      'The model returned incomplete HTML. Retry with a smaller request.'
    );
}
