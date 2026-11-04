import { describe, expect, it } from 'bun:test';
import type { SpatialActionFrame, SpatialNodeItem } from '@/types/spatial';
import {
  assertSpatialSourceContract,
  shapeSourceRevision,
  spatialNodeSourceRevision,
  mergeDeckSlidesPreservingUnknownFields,
} from './spatialSourceContract';
import { clearShapeDraft, writeShapeDraft } from '@/hooks/useShapeDraft';

const artifactNode = (code = '<main>complete source</main>'): SpatialNodeItem => ({
  id: 'shape:app-1',
  type: 'artifact',
  minX: 0,
  minY: 0,
  maxX: 100,
  maxY: 100,
  title: 'Counter',
  code,
});

const artifactShape = (code = '<main>complete source</main>') => ({
  type: 'artifact',
  props: { title: 'Counter', code },
});

const mutateArtifact = (target = 'shape:app-1'): SpatialActionFrame => ({
  t: 'patch',
  op: 'mutate_artifact',
  target,
  title: 'Counter',
  code: '<main>replacement</main>',
});

describe('spatial source revision contract', () => {
  it('accepts a full selected source only while the current source is that revision', () => {
    const node = artifactNode();
    expect(spatialNodeSourceRevision(node)).toBe(
      shapeSourceRevision(artifactShape())
    );
    expect(() =>
      assertSpatialSourceContract([mutateArtifact()], [node], (id) =>
        id === 'shape:app-1' ? artifactShape() : undefined
      )
    ).not.toThrow();
  });

  it('rejects preview-only, missing, and wrong-type replacement sources', () => {
    const preview = artifactNode('<main>partial preview…</main>');
    expect(() =>
      assertSpatialSourceContract([mutateArtifact()], [preview], () =>
        artifactShape()
      )
    ).toThrow(/changed after its full content/i);
    expect(() =>
      assertSpatialSourceContract([mutateArtifact()], [], () => artifactShape())
    ).toThrow(/not supplied to the model/i);

    const codeCard: SpatialNodeItem = {
      ...artifactNode(),
      type: 'code_card',
      language: 'typescript',
    };
    expect(() =>
      assertSpatialSourceContract([mutateArtifact()], [codeCard], () => ({
        type: 'code_card',
        props: { title: 'Counter', language: 'typescript', code: '<main>complete source</main>' },
      }))
    ).toThrow(/wrong shape type/i);
  });

  it('rejects a stale target revision before applying replacement', () => {
    expect(() =>
      assertSpatialSourceContract([mutateArtifact()], [artifactNode()], () =>
        artifactShape('<main>externally changed</main>')
      )
    ).toThrow(/changed after its full content/i);
  });

  it('blocks AI replacement while the target has a dirty local source draft', () => {
    const draftKey = 'artifact:shape:app-1:source';
    writeShapeDraft(
      draftKey,
      {
        value: '<main>unsaved local edit</main>',
        baseRevision: JSON.stringify('<main>complete source</main>'),
        updatedAt: 1,
      },
      undefined,
      'memory-only'
    );
    try {
      expect(() =>
        assertSpatialSourceContract([mutateArtifact()], [artifactNode()], () =>
          artifactShape()
        )
      ).toThrow(/save or discard the local source draft/i);
    } finally {
      clearShapeDraft(draftKey, undefined, 'memory-only');
    }
  });

  it('rechecks dirty drafts that begin after dispatch and before apply', () => {
    const draftKey = 'artifact:shape:app-1:source';
    const current = () => artifactShape();

    // Dispatch-time authorization succeeds while no editor draft exists.
    expect(() =>
      assertSpatialSourceContract([mutateArtifact()], [artifactNode()], current)
    ).not.toThrow();

    // The local solver runs asynchronously. A user can start editing the source
    // after dispatch without changing the tldraw shape record or its snapshot.
    writeShapeDraft(
      draftKey,
      {
        value: '<main>new local edit</main>',
        baseRevision: JSON.stringify('<main>complete source</main>'),
        updatedAt: 2,
      },
      undefined,
      'memory-only'
    );
    try {
      expect(() =>
        assertSpatialSourceContract([mutateArtifact()], [artifactNode()], current)
      ).toThrow(/save or discard the local source draft/i);
    } finally {
      clearShapeDraft(draftKey, undefined, 'memory-only');
    }
  });

  it('blocks full document replacement while its recovered content draft is dirty', () => {
    const section = { id: 'section-1', title: 'Intro', content: 'persisted' };
    const node: SpatialNodeItem = {
      id: 'shape:doc-1', type: 'document', minX: 0, minY: 0, maxX: 100, maxY: 100,
      title: 'Notes', sections: [section],
    };
    const frame: SpatialActionFrame = {
      t: 'patch', op: 'mutate_document', target: node.id,
      title: 'Notes', sections: [{ ...section, content: 'AI replacement' }],
    };
    const draftKey = 'document:shape:doc-1:content';
    writeShapeDraft(
      draftKey,
      {
        value: { title: 'Notes', sections: [{ ...section, content: 'unsaved edit' }] },
        baseRevision: JSON.stringify({ title: 'Notes', sections: [section] }),
        updatedAt: 1,
      },
      undefined,
      'memory-only'
    );
    try {
      expect(() => assertSpatialSourceContract([frame], [node], () => ({
        type: 'document',
        props: { title: 'Notes', sections: [section] },
      }))).toThrow(/save or discard the local source draft/i);
    } finally {
      clearShapeDraft(draftKey, undefined, 'memory-only');
    }
  });

  it('requires the selected complete deck source and blocks a dirty deck draft', () => {
    const slides = [{
      id: 'slide-1', title: 'Overview', layout: 'split',
      speakerNotes: 'Presenter context', futureField: { preserved: true },
    }];
    const node: SpatialNodeItem = {
      id: 'shape:deck-1', type: 'slide_deck', minX: 0, minY: 0, maxX: 800, maxY: 500,
      title: 'Roadmap', subtitle: 'Q4', theme: 'paper', currentSlideIndex: 0, slides,
    };
    const frame: SpatialActionFrame = {
      t: 'patch', op: 'mutate_slide_deck', target: node.id,
      title: 'Roadmap', subtitle: 'Q4', theme: 'ocean', currentSlideIndex: 0,
      slides: [{ id: 'slide-1', title: 'Overview', layout: 'hero', speakerNotes: 'Presenter context' }],
    };
    const current = () => ({ type: 'slide_deck', props: {
      title: 'Roadmap', subtitle: 'Q4', theme: 'paper', currentSlideIndex: 0, slides,
    } });
    expect(() => assertSpatialSourceContract([frame], [node], current)).not.toThrow();
    expect(() => assertSpatialSourceContract([frame], [], current)).toThrow(/not supplied to the model/i);
    expect(() => assertSpatialSourceContract([frame], [node], () => ({
      type: 'slide_deck', props: { ...current().props, slides: [{ ...slides[0], title: 'Externally edited' }] },
    }))).toThrow(/changed after its full content/i);

    const draftKey = 'slide-deck:shape:deck-1:content';
    writeShapeDraft(
      draftKey,
      {
        value: { title: 'Local draft', theme: 'paper', slides },
        baseRevision: JSON.stringify({ title: 'Roadmap', theme: 'paper', slides }),
        updatedAt: 1,
      },
      undefined,
      'memory-only'
    );
    try {
      expect(() => assertSpatialSourceContract([frame], [node], current)).toThrow(/save or discard the local source draft/i);
    } finally {
      clearShapeDraft(draftKey, undefined, 'memory-only');
    }
  });

  it('preserves uneditable forward metadata on retained slides during full AI replacement', () => {
    const result = mergeDeckSlidesPreservingUnknownFields(
      [{
        id: 'slide-1', title: 'Old title', futureField: { keep: 1 },
        stats: [{ label: 'Users', value: '10', futureUnit: 'people' }],
      }],
      [{ id: 'slide-1', title: 'New title', stats: [{ label: 'Users', value: '20' }] }]
    );
    expect(result).toEqual([{
      id: 'slide-1', title: 'New title', futureField: { keep: 1 },
      stats: [{ label: 'Users', value: '20', futureUnit: 'people' }],
    }]);
  });

  it('rejects create-ID reuse and duplicate IDs in a batch', () => {
    const spawn: SpatialActionFrame = {
      t: 'patch',
      op: 'spawn_artifact',
      id: 'app-1',
      title: 'Counter',
      code: '<main>replacement</main>',
    };
    expect(() =>
      assertSpatialSourceContract([spawn], [], (id) =>
        id === 'shape:app-1' ? artifactShape() : undefined
      )
    ).toThrow(/cannot reuse an existing/i);

    const duplicate = { ...spawn, id: 'new-app' };
    expect(() =>
      assertSpatialSourceContract([duplicate, duplicate], [], () => undefined)
    ).toThrow(/same canvas object ID twice/i);
  });

  it('allows a later replacement of a complete object created earlier in the same batch', () => {
    const spawn: SpatialActionFrame = {
      t: 'patch',
      op: 'spawn_artifact',
      id: 'new-app',
      title: 'Counter',
      code: '<main>first source</main>',
    };
    expect(() =>
      assertSpatialSourceContract(
        [spawn, { ...mutateArtifact('new-app'), code: '<main>second source</main>' }],
        [],
        () => undefined
      )
    ).not.toThrow();
  });
});
