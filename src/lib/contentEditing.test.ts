import { describe, expect, it } from 'bun:test';
import {
  deckToJson,
  deckToMarkdown,
  documentToMarkdown,
  isValidDeckDraft,
  isValidDocumentDraft,
  moveItem,
  safeContentFilename,
  type DeckDraft,
  type DocumentDraft,
} from './contentEditing';
import { docSectionsValidator, slideItemsValidator } from './shapeContentSchema';

describe('content editor validation', () => {
  it('accepts a true empty document and rejects duplicate or over-limit sections', () => {
    expect(isValidDocumentDraft({ title: 'Notes', sections: [] })).toBe(true);
    expect(isValidDocumentDraft({
      title: 'Notes',
      sections: [
        { id: 'same', title: 'One', content: '' },
        { id: 'same', title: 'Two', content: '' },
      ],
    })).toBe(false);
    expect(isValidDocumentDraft({
      title: 'Notes',
      sections: [{ id: 'large', title: 'Body', content: 'x'.repeat(180_001) }],
    })).toBe(false);
  });

  it('permits an empty deck, validates nested timeline step bounds, and preserves legacy fields', () => {
    expect(isValidDeckDraft({ title: 'Deck', theme: 'midnight', slides: [] })).toBe(true);
    const legacy = {
      title: 'Deck', theme: 'midnight', canvaEmbedUrl: 'https://example.com/slides', currentSlideIndex: 0,
      slides: [{ id: 'slide-1', title: 'Intro', oldField: { accent: 'blue' }, timelineSteps: [{ step: '1', title: 'Start', desc: 'Go', oldField: 2 }] }],
    };
    expect(isValidDeckDraft(legacy)).toBe(true);
    expect(isValidDeckDraft({
      title: 'Deck', theme: 'midnight', slides: [{
        id: 'slide-1', title: 'Intro', timelineSteps: [{ step: 'x'.repeat(257), title: 'Start', desc: 'Go' }],
      }],
    })).toBe(false);
    expect(isValidDeckDraft({
      title: 'Deck', theme: 'midnight', slides: Array.from({ length: 101 }, (_, index) => ({ id: `s${index}`, title: 'Slide' })),
    })).toBe(false);
  });

  it('keeps persisted records within the original backup envelope loadable', () => {
    const legacySections = Array.from({ length: 101 }, (_, index) => ({
      id: `section-${index}`,
      title: `Section ${index}`,
      content: index === 0 ? 'x'.repeat(200_000) : '',
      legacyFlag: true,
    }));
    const legacySlides = Array.from({ length: 101 }, (_, index) => ({
      id: `slide-${index}`,
      title: `Slide ${index}`,
      legacyLayoutField: 'kept',
    }));
    expect(() => docSectionsValidator.validate(legacySections)).not.toThrow();
    expect(() => slideItemsValidator.validate(legacySlides)).not.toThrow();
    expect(() => docSectionsValidator.validate([
      { id: 'same', title: 'One', content: '' },
      { id: 'same', title: 'Two', content: '' },
    ])).toThrow(/unique/i);
  });
});

describe('content export helpers', () => {
  const document: DocumentDraft = {
    title: 'Release notes', subtitle: 'Iteration 2', author: 'A. Author', date: '2026-10-23',
    sections: [{ id: 'section-1', title: 'Changes', badge: 'Updated', content: 'Added editor\n\nKept formatting.' }],
  };

  const deck: DeckDraft = {
    title: 'Quarterly plan', subtitle: 'Q4', theme: 'ocean', currentSlideIndex: 1,
    canvaEmbedUrl: 'https://example.com/embed',
    slides: [
      { id: 'slide-a', title: 'Metrics', layout: 'stats', stats: [{ label: 'Revenue', value: '$5M', change: '+8%' }] },
      {
        id: 'slide-b', title: 'Plan', subtitle: 'Next steps', layout: 'timeline', content: 'What happens next',
        bullets: ['Fund the team'], columns: [{ title: 'Owner', text: 'Product', icon: 'person' }],
        timelineSteps: [{ step: '1', title: 'Research', desc: 'Talk to users' }], speakerNotes: 'Pause here.',
        legacyPresentationData: { source: 'imported' },
      },
    ],
  };

  it('exports document metadata, section IDs, badges, and Markdown bodies', () => {
    const markdown = documentToMarkdown(document);
    for (const value of ['# Release notes', 'Subtitle: Iteration 2', 'Author: A. Author', 'Date: 2026-10-23', 'section-id: section-1', '> Badge: Updated', 'Kept formatting.']) {
      expect(markdown).toContain(value);
    }
  });

  it('exports every deck content field in Markdown and structured JSON', () => {
    const markdown = deckToMarkdown(deck);
    for (const value of ['Theme: ocean', 'Current slide: 2', 'slide-id: slide-b', 'Layout: timeline', 'Revenue: $5M (+8%)', 'Fund the team', 'Owner [person]: Product', '1 — Research: Talk to users', 'Speaker notes:\nPause here.', 'Embed: https://example.com/embed']) {
      expect(markdown).toContain(value);
    }
    const roundTrip = JSON.parse(deckToJson(deck, 1));
    expect(roundTrip).toMatchObject({
      version: 1,
      title: deck.title,
      subtitle: deck.subtitle,
      theme: deck.theme,
      canvaEmbedUrl: deck.canvaEmbedUrl,
      currentSlideIndex: 1,
      slides: deck.slides,
    });
  });

  it('moves items only when both positions are in bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 8)).toEqual(['a', 'b']);
  });

  it('bounds and sanitizes download names derived from titles', () => {
    expect(safeContentFilename('  Q4 Plan / Recap  ', 'deck')).toBe('q4_plan_recap');
    expect(safeContentFilename('雪', 'deck')).toBe('deck');
    expect(safeContentFilename('a'.repeat(500), 'deck')).toHaveLength(80);
  });
});
