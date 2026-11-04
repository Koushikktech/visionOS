import { describe, expect, it } from 'bun:test';
import { convertToolCallToActionFrame } from './prompt';
import { validateAction } from './actions';
import { CANVAS_TOOLS } from './prompt';

const slide = { id: 'slide-1', title: 'Opening', layout: 'hero' };

describe('native presentation actions', () => {
  it('converts and validates a deck creation tool call', () => {
    const frame = convertToolCallToActionFrame('create_slide_deck', {
      id: 'deck-brief',
      title: 'Project brief',
      slides: [slide],
    });

    expect(frame).toMatchObject({
      t: 'patch', op: 'create_slide_deck', id: 'deck-brief',
      theme: 'midnight', currentSlideIndex: 0, slides: [slide],
    });
    expect(validateAction(frame)).toBe(frame);
    expect(CANVAS_TOOLS.map((tool) => tool.name)).toContain('create_slide_deck');
  });

  it('requires a full slide list for deck mutations and rejects malformed content', () => {
    const frame = convertToolCallToActionFrame('mutate_slide_deck', {
      target: 'shape:deck-brief',
      theme: 'paper',
      slides: [{ ...slide, speakerNotes: 'Explain the project scope.' }],
    });
    expect(frame?.op).toBe('mutate_slide_deck');
    expect(validateAction(frame)).toBe(frame);
    expect(() => validateAction({ ...frame, slides: undefined })).toThrow(/complete slide list/i);
    expect(() => validateAction({ ...frame, theme: 'unknown' })).toThrow(/theme/i);
    expect(() => validateAction({ ...frame, slides: [slide, slide] })).toThrow(/unique/i);
    expect(() => validateAction({ ...frame, slides: [{ ...slide, timelineSteps: [{ step: 'x'.repeat(257), title: 'Start', desc: 'Begin' }] }] })).toThrow(/timelineSteps.step/i);
    expect(() => validateAction({ ...frame, slides: [{ ...slide, unsupportedLegacyField: true }] })).toThrow(/Unsupported field/i);
  });

  it('bounds slide count and requires an exact target', () => {
    const frame = { t: 'patch', op: 'mutate_slide_deck', target: 'shape:deck', slides: [] };
    expect(() => validateAction({ ...frame, target: undefined })).toThrow(/exact target/i);
    expect(() => validateAction({ ...frame, slides: Array.from({ length: 101 }, (_, index) => ({ id: `s-${index}`, title: 'Slide' })) })).toThrow(/100 slides/i);
    expect(() => validateAction({ t: 'patch', op: 'create_slide_deck', id: 'empty-deck', slides: [] })).toThrow(/at least one slide/i);
  });
});
