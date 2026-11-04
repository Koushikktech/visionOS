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
  'create_slide_deck',
  'mutate_slide_deck',
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
const deckThemes = new Set(['midnight', 'paper', 'ocean', 'plum']);
const deckLayouts = new Set(['hero', 'split', 'columns', 'stats', 'timeline', 'takeaway']);

function assertDeckSlides(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error(`${label} must contain at most 100 slides.`);
  const ids = new Set<string>();
  let total = 0;
  const boundedString = (item: unknown, max: number, name: string, required = false) => {
    if (item === undefined && !required) return;
    if (typeof item !== 'string' || item.length > max || (required && !item.trim()))
      throw new Error(`Invalid ${name}.`);
  };
  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      throw new Error(`Invalid ${label} slide.`);
    const slide = candidate as Record<string, unknown>;
    const allowed = new Set(['id', 'title', 'subtitle', 'layout', 'bullets', 'content', 'speakerNotes', 'stats', 'columns', 'timelineSteps']);
    if (Object.keys(slide).some((key) => !allowed.has(key)))
      throw new Error(`Unsupported field in ${label} slide ${index + 1}.`);
    boundedString(slide.id, 1_024, `${label} slide ID`, true);
    boundedString(slide.title, 4_000, `${label} slide title`, true);
    if (ids.has(slide.id as string)) throw new Error(`${label} slide IDs must be unique.`);
    ids.add(slide.id as string);
    boundedString(slide.subtitle, 4_000, `${label} slide subtitle`);
    boundedString(slide.content, 30_000, `${label} slide content`);
    boundedString(slide.speakerNotes, 10_000, `${label} speaker notes`);
    if (slide.layout !== undefined && (typeof slide.layout !== 'string' || !deckLayouts.has(slide.layout)))
      throw new Error(`Invalid ${label} slide layout.`);
    if (slide.bullets !== undefined && (!Array.isArray(slide.bullets) || slide.bullets.length > 100 || !slide.bullets.every((item) => typeof item === 'string' && item.length <= 4_000)))
      throw new Error(`Invalid ${label} slide bullets.`);
    for (const [field, maxItems, shape] of [
      ['stats', 50, { required: ['label', 'value'], optional: ['change'], max: 4_000 }],
      ['columns', 20, { required: ['title', 'text'], optional: ['icon'], max: 4_000 }],
      ['timelineSteps', 50, { required: ['step', 'title', 'desc'], optional: [], max: 4_000 }],
    ] as const) {
      const entries = slide[field];
      if (entries === undefined) continue;
      if (!Array.isArray(entries) || entries.length > maxItems)
        throw new Error(`Invalid ${label} slide ${field}.`);
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          throw new Error(`Invalid ${label} slide ${field} item.`);
        const record = entry as Record<string, unknown>;
        const keys = new Set<string>([...shape.required, ...shape.optional]);
        if (Object.keys(record).some((key) => !keys.has(key)))
          throw new Error(`Unsupported field in ${label} slide ${field} item.`);
        for (const key of shape.required) boundedString(record[key], key === 'step' ? 256 : shape.max, `${label} ${field}.${key}`, true);
        for (const key of shape.optional) boundedString(record[key], key === 'icon' ? 128 : shape.max, `${label} ${field}.${key}`);
      }
    }
    total += JSON.stringify(slide).length;
  }
  if (total > 180_000) throw new Error(`${label} exceeds the content limit.`);
}
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
    'theme',
    'currentSlideIndex',
    'slides',
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
        'theme',
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
  if (f.op === 'create_slide_deck' || f.op === 'mutate_slide_deck') {
    if (f.slides === undefined) throw new Error(`${f.op} needs the complete slide list.`);
    assertDeckSlides(f.slides, 'Deck');
    if (f.title !== undefined && (typeof f.title !== 'string' || f.title.length > 4_000))
      throw new Error('Deck title is too long.');
    if (f.subtitle !== undefined && (typeof f.subtitle !== 'string' || f.subtitle.length > 4_000))
      throw new Error('Deck subtitle is too long.');
    if (f.op === 'create_slide_deck' && f.slides.length === 0)
      throw new Error('A new deck needs at least one slide.');
    if (f.op === 'create_slide_deck' && !f.id)
      throw new Error('Creating a slide deck needs a new ID.');
    if (f.theme !== undefined && (typeof f.theme !== 'string' || !deckThemes.has(f.theme)))
      throw new Error('Unsupported deck theme.');
    if (f.currentSlideIndex !== undefined && (!Number.isInteger(f.currentSlideIndex) || f.currentSlideIndex < 0 || f.currentSlideIndex >= Math.max(f.slides.length, 1)))
      throw new Error('Invalid active slide index.');
  } else if (f.theme !== undefined || f.currentSlideIndex !== undefined || f.slides !== undefined) {
    throw new Error('Deck fields are only valid for deck actions.');
  }
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
