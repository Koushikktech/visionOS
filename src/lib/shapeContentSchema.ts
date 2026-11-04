import { T } from '@tldraw/tldraw';

const boundedString = (max: number) =>
  T.string.check((value) => {
    if (value.length > max) throw new Error(`String exceeds ${max} characters.`);
  });

const boundedArray = <TValue>(validator: T.Validator<TValue>, max: number) =>
  T.arrayOf(validator).check((value) => {
    if (value.length > max) throw new Error(`Array exceeds ${max} items.`);
  });

// These are persisted-record validators. Keep them at least as permissive as
// the supported backup format so a newer editor does not make older records
// impossible to load. The stricter limits for newly edited content live in
// contentEditing.ts.
const PERSISTED_CONTENT_CHARS = 25_000_000;
const PERSISTED_ITEMS = 500;
const PERSISTED_FIELD_CHARS = 1_000_000;

export const docSectionValidator = T.object({
  id: boundedString(1_024),
  title: boundedString(20_000),
  content: boundedString(PERSISTED_FIELD_CHARS),
  badge: T.optional(boundedString(500)),
}).allowUnknownProperties();

export const docSectionsValidator = boundedArray(docSectionValidator, PERSISTED_ITEMS).check((sections) => {
  const ids = sections.map((section) => section.id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error('Document section IDs must be nonempty and unique.');
  if (sections.reduce((size, section) => size + section.id.length + section.title.length + section.content.length + (section.badge?.length || 0), 0) > PERSISTED_CONTENT_CHARS)
    throw new Error('Document content exceeds the persisted content limit.');
  let serializedSize = 0;
  try {
    serializedSize = JSON.stringify(sections).length;
  } catch {
    throw new Error('Document content must be serializable.');
  }
  if (serializedSize > PERSISTED_CONTENT_CHARS) throw new Error('Document content exceeds the persisted content limit.');
});

export const documentTitleValidator = boundedString(PERSISTED_FIELD_CHARS);
export const documentSubtitleValidator = T.optional(boundedString(PERSISTED_FIELD_CHARS));
export const documentAuthorValidator = T.optional(boundedString(PERSISTED_FIELD_CHARS));
export const documentDateValidator = T.optional(boundedString(PERSISTED_FIELD_CHARS));

export const slideStatValidator = T.object({
  label: boundedString(20_000),
  value: boundedString(20_000),
  change: T.optional(boundedString(20_000)),
}).allowUnknownProperties();

export const slideColumnValidator = T.object({
  title: boundedString(20_000),
  text: boundedString(20_000),
  icon: T.optional(boundedString(20_000)),
}).allowUnknownProperties();

export const slideTimelineStepValidator = T.object({
  step: boundedString(20_000),
  title: boundedString(20_000),
  desc: boundedString(20_000),
}).allowUnknownProperties();

export const slideItemValidator = T.object({
  id: boundedString(1_024),
  title: boundedString(20_000),
  subtitle: T.optional(boundedString(PERSISTED_FIELD_CHARS)),
  layout: T.optional(boundedString(PERSISTED_FIELD_CHARS)),
  bullets: T.optional(boundedArray(boundedString(20_000), PERSISTED_ITEMS)),
  content: T.optional(boundedString(PERSISTED_FIELD_CHARS)),
  speakerNotes: T.optional(boundedString(PERSISTED_FIELD_CHARS)),
  stats: T.optional(boundedArray(slideStatValidator, PERSISTED_ITEMS)),
  columns: T.optional(boundedArray(slideColumnValidator, PERSISTED_ITEMS)),
  timelineSteps: T.optional(boundedArray(slideTimelineStepValidator, PERSISTED_ITEMS)),
}).allowUnknownProperties();

export const slideItemsValidator = boundedArray(slideItemValidator, PERSISTED_ITEMS).check((slides) => {
  const ids = slides.map((slide) => slide.id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error('Slide IDs must be nonempty and unique.');
  if (slides.reduce((size, slide) => size + JSON.stringify(slide).length, 0) > PERSISTED_CONTENT_CHARS)
    throw new Error('Slide deck content exceeds the persisted content limit.');
});

export const deckThemeValidator = boundedString(PERSISTED_FIELD_CHARS);
