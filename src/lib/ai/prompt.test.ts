import { describe, it, expect } from 'bun:test';
import {
  buildSpatialContextText,
  convertToolCallToActionFrame,
  isCanvasActionIntent,
  isExplicitCanvasMutationCommand,
  extractActionFramesFromText,
  getFrameCleanSummary,
} from './prompt';
import type { AISpatialChatRequest } from '@/types/spatial';

describe('prompt & grounded context utilities', () => {
  it('formats selected shapes with full details and grounded context', () => {
    const request: AISpatialChatRequest = {
      messages: [{ role: 'user', content: 'Summarize these cards' }],
      culledContext: {
        selectedNodes: [
          {
            id: 'node_1',
            type: 'rich_card',
            minX: 100,
            minY: 100,
            maxX: 300,
            maxY: 200,
            title: 'Distributed Consensus',
            content: 'Proof of Stake breakdown with formulas',
            archetype: 'research',
            color: 'light-violet',
          },
          {
            id: 'code_2',
            type: 'code_card',
            minX: 350,
            minY: 100,
            maxX: 700,
            maxY: 300,
            title: 'consensus.ts',
            language: 'typescript',
            code: 'export function vote() { return true; }',
          },
        ],
        viewportNeighbors: [],
        macroClusters: [],
        totalTokenEstimate: 80,
      },
      viewportInfo: {
        zoom: 1.2,
        center: { x: 400, y: 200 },
        visibleShapeCount: 5,
      },
      visualSnapshot: {
        mimeType: 'image/png',
        base64: 'abc123==',
      },
    };

    const text = buildSpatialContextText(request);
    expect(text).toContain('USER SELECTION FOCUS (2 shapes currently selected by user');
    expect(text).toContain('ID: "node_1"');
    expect(text).toContain('Title: "Distributed Consensus"');
    expect(text).toContain('Proof of Stake breakdown with formulas');
    expect(text).toContain('ID: "code_2"');
    expect(text).toContain('Current Source Code:');
    expect(text).toContain('export function vote() { return true; }');
    expect(text).toContain('Camera Zoom Level: 1.20x');
    expect(text).toContain('Multimodal Vision Snapshot Attached: YES');
  });

  it('includes complete editable source for selected decks and only a preview for nearby decks', () => {
    const request: AISpatialChatRequest = {
      messages: [{ role: 'user', content: 'Refine the selected deck.' }],
      culledContext: {
        selectedNodes: [{
          id: 'shape:selected-deck', type: 'slide_deck', minX: 0, minY: 0, maxX: 800, maxY: 500,
          title: 'Product launch', theme: 'ocean', currentSlideIndex: 1,
          slides: [
            { id: 'slide-1', title: 'Intro', layout: 'hero', speakerNotes: 'Open with the user need.' },
            { id: 'slide-2', title: 'Results', layout: 'stats', stats: [{ label: 'Adoption', value: '42%', change: '+8%' }] },
          ],
        }],
        viewportNeighbors: [{
          id: 'shape:nearby-deck', type: 'slide_deck', minX: 900, minY: 0, maxX: 1700, maxY: 500,
          title: 'Nearby', theme: 'paper', slides: [{ id: 'private', title: 'Preview only', content: 'Do not include this body.' }],
        }],
        macroClusters: [], totalTokenEstimate: 100,
      },
    };
    const text = buildSpatialContextText(request);
    expect(text).toContain('Deck theme: ocean');
    expect(text).toContain('Active slide index: 1');
    expect(text).toContain('Open with the user need.');
    expect(text).toContain('Adoption');
    expect(text).toContain('Deck preview: 1 slides, theme paper');
    expect(text).not.toContain('Do not include this body.');
  });

  it('converts native deck create and full-replacement tool calls', () => {
    const created = convertToolCallToActionFrame('create_slide_deck', {
      id: 'launch-deck', title: 'Launch', theme: 'plum',
      slides: [{ id: 'intro', title: 'Introduction', layout: 'hero', speakerNotes: 'Set context.' }],
    });
    expect(created).toMatchObject({ op: 'create_slide_deck', theme: 'plum', currentSlideIndex: 0 });

    const mutated = convertToolCallToActionFrame('mutate_slide_deck', {
      target: 'shape:launch-deck', theme: 'paper',
      slides: [{ id: 'intro', title: 'Introduction', layout: 'split' }],
    });
    expect(mutated).toMatchObject({ op: 'mutate_slide_deck', target: 'shape:launch-deck', theme: 'paper' });
  });

  it('converts spawn_artifact tool call with relative anchor and default 780x540 dimensions', () => {
    const frame = convertToolCallToActionFrame('spawn_artifact', {
      id: 'app_calculator',
      title: 'Interactive Calculator',
      code: '```html\n<button>1</button>\n```',
      relative: 'right_of:node_1',
    });

    expect(frame).not.toBeNull();
    expect(frame?.op).toBe('spawn_artifact');
    expect(frame?.id).toBe('app_calculator');
    expect(frame?.title).toBe('Interactive Calculator');
    expect(frame?.relative).toBe('right_of:node_1');
    expect(frame?.code).toBe('<button>1</button>');
    expect(frame?.w).toBe(780);
    expect(frame?.h).toBe(540);
  });

  it('converts spawn_artifact tool call with custom width and height', () => {
    const frame = convertToolCallToActionFrame('spawn_artifact', {
      id: 'app_dashboard',
      title: 'Analytics Dashboard',
      code: '<div>Dashboard</div>',
      width: 960,
      height: 640,
    });

    expect(frame?.w).toBe(960);
    expect(frame?.h).toBe(640);
  });

  it('converts mutate_code_card tool call targeting selected code card', () => {
    const frame = convertToolCallToActionFrame('mutate_code_card', {
      target: 'code_2',
      code: 'export function vote() { return false; }',
      title: 'consensus_fixed.ts',
    });

    expect(frame).not.toBeNull();
    expect(frame?.op).toBe('mutate_code_card');
    expect(frame?.target).toBe('code_2');
    expect(frame?.code).toBe('export function vote() { return false; }');
  });

  it('converts connect_shapes tool call between two cards', () => {
    const frame = convertToolCallToActionFrame('connect_shapes', {
      from: 'node_1',
      to: 'code_2',
      label: 'implements',
    });

    expect(frame).not.toBeNull();
    expect(frame?.op).toBe('connect');
    expect(frame?.from).toBe('node_1');
    expect(frame?.to).toBe('code_2');
    expect(frame?.label).toBe('implements');
  });

  it('does not log an unrecognized provider tool name or arguments', () => {
    const previousWarn = console.warn;
    const secret = 'private-canvas-source-123';
    let logged = '';
    console.warn = (...args) => { logged += args.join(' '); };
    try {
      expect(convertToolCallToActionFrame('private_tool_name_123', { source: secret })).toBeNull();
      expect(logged).not.toContain(secret);
      expect(logged).not.toContain('private_tool_name_123');
    } finally {
      console.warn = previousWarn;
    }
  });

  describe('isCanvasActionIntent', () => {
    it('returns false for pure greetings and pleasantries', () => {
      expect(isCanvasActionIntent('hi')).toBe(false);
      expect(isCanvasActionIntent('hi\\')).toBe(false);
      expect(isCanvasActionIntent('hello')).toBe(false);
      expect(isCanvasActionIntent('hey there!')).toBe(false);
      expect(isCanvasActionIntent('how are you?')).toBe(false);
      expect(isCanvasActionIntent('what can you do?')).toBe(false);
      expect(isCanvasActionIntent('thanks')).toBe(false);
      expect(isCanvasActionIntent('cool')).toBe(false);
    });

    it('returns false for conversational questions without canvas commands', () => {
      expect(isCanvasActionIntent('what is quantum computing?')).toBe(false);
      expect(isCanvasActionIntent('explain sliding window algorithm')).toBe(false);
      expect(isCanvasActionIntent('why is react fast?')).toBe(false);
      expect(isCanvasActionIntent('what is on my canvas?')).toBe(false);
      expect(isCanvasActionIntent('what do i have on this board?')).toBe(false);
      expect(isCanvasActionIntent('what does this diagram mean?', true)).toBe(false);
      expect(isCanvasActionIntent('can you explain this architecture?', true)).toBe(false);
      expect(isCanvasActionIntent('how do i create a card?')).toBe(false);
    });

    it('returns true for explicit canvas creation commands', () => {
      expect(isCanvasActionIntent('create a card about binary trees')).toBe(true);
      expect(isCanvasActionIntent('draw architecture diagram for auth')).toBe(true);
      expect(isCanvasActionIntent('generate a note on consensus')).toBe(true);
      expect(isCanvasActionIntent('build an app for calculator')).toBe(true);
      expect(isCanvasActionIntent('make real')).toBe(true);
      expect(isCanvasActionIntent('put this on the canvas')).toBe(true);
      expect(isCanvasActionIntent('organize the board')).toBe(true);
      expect(isCanvasActionIntent('connect the database to the backend')).toBe(true);
      expect(isCanvasActionIntent('create a slide deck about AI roadmap')).toBe(true);
      expect(isCanvasActionIntent('make a presentation on Q3 growth')).toBe(true);
      expect(isCanvasActionIntent('generate a document on auth spec')).toBe(true);
    });

    it('returns true for targeted actions when shapes are selected', () => {
      expect(isCanvasActionIntent('summarize these', true)).toBe(true);
      expect(isCanvasActionIntent('fix the bug in this code', true)).toBe(true);
      expect(isCanvasActionIntent('connect these cards', true)).toBe(true);
      expect(isCanvasActionIntent('remake this application', true)).toBe(true);
      expect(isCanvasActionIntent('remake this application', false)).toBe(true);
      expect(isCanvasActionIntent('remake this app with better ui and fuctionality', true)).toBe(true);
      expect(isCanvasActionIntent('remake this app with better ui and fuctionality', false)).toBe(true);
      expect(isCanvasActionIntent('rebuild this app', true)).toBe(true);
      expect(isCanvasActionIntent('hi', true)).toBe(false); // even with selection, 'hi' is still not a canvas action!
    });
  });

  describe('isExplicitCanvasMutationCommand', () => {
    it('recognizes direct editing commands and polite command forms', () => {
      expect(isExplicitCanvasMutationCommand('create a card about biology')).toBe(true);
      expect(isExplicitCanvasMutationCommand('Could you please move this card?')).toBe(true);
      expect(isExplicitCanvasMutationCommand('make real')).toBe(true);
    });

    it('leaves questions and conversational requests available in read-only mode', () => {
      expect(isExplicitCanvasMutationCommand('How do I create a card?')).toBe(false);
      expect(isExplicitCanvasMutationCommand('Can you explain this diagram?')).toBe(false);
      expect(isExplicitCanvasMutationCommand('Summarize these shapes')).toBe(false);
    });
  });

  describe('extractActionFramesFromText', () => {
    it('extracts mutate_artifact action frame from raw JSON dumped into text', () => {
      const dumpedResponse = `\`\`\`json
{
  "target": "shape:0YAn7_kKpgpzNo-GmsckI",
  "title": "DSA Core 53 - Interactive Tracker",
  "color": "light-violet",
  "width": 960,
  "height": 680,
  "code": "<!DOCTYPE html><html><head><title>DSA</title></head><body><h1>Tracker</h1></body></html>"
}
\`\`\``;

      const result = extractActionFramesFromText(dumpedResponse);
      expect(result.frames.length).toBe(1);
      const frame = result.frames[0];
      expect(frame.op).toBe('mutate_artifact');
      expect(frame.target).toBe('shape:0YAn7_kKpgpzNo-GmsckI');
      expect(frame.title).toBe('DSA Core 53 - Interactive Tracker');
      expect(frame.w).toBe(960);
      expect(frame.h).toBe(680);
      expect(frame.code).toContain('<!DOCTYPE html>');
      expect(result.cleanText).not.toContain('shape:0YAn7_kKpgpzNo-GmsckI');
      expect(result.cleanText).toContain('DSA Core 53 - Interactive Tracker');
    });

    it('extracts mutate_artifact from raw JSON with unescaped multiline code and attributes', () => {
      const multilinePayload = `{
  "target": "shape:0YAn7_kKpgpzNo-GmsckI",
  "title": "DSA Core 53 - Interactive Tracker",
  "color": "light-violet",
  "width": 960,
  "height": 680,
  "code": "<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DSA Core 53</title>
</head>
<body>
<div class="container">
<h1>DSA Tracker</h1>
</div>
</body>
</html>"
}`;

      const result = extractActionFramesFromText(multilinePayload);
      expect(result.frames.length).toBe(1);
      const frame = result.frames[0];
      expect(frame.op).toBe('mutate_artifact');
      expect(frame.target).toBe('shape:0YAn7_kKpgpzNo-GmsckI');
      expect(frame.title).toBe('DSA Core 53 - Interactive Tracker');
      expect(frame.w).toBe(960);
      expect(frame.h).toBe(680);
      expect(frame.code).toContain('<!DOCTYPE html>');
      expect(result.cleanText).toContain('DSA Core 53 - Interactive Tracker');
    });

    it('extracts spawn_artifact from bare JSON in text without markdown fences', () => {
      const bareResponse = `{
  "title": "Particle Playground",
  "width": 840,
  "height": 560,
  "code": "<!DOCTYPE html><html><body><canvas id='c'></canvas></body></html>"
}`;

      const result = extractActionFramesFromText(bareResponse);
      expect(result.frames.length).toBe(1);
      expect(result.frames[0].op).toBe('spawn_artifact');
      expect(result.frames[0].title).toBe('Particle Playground');
      expect(result.frames[0].w).toBe(840);
      expect(result.frames[0].h).toBe(560);
      expect(result.cleanText).toContain('Particle Playground');
    });
  });

  describe('getFrameCleanSummary', () => {
    it('returns a factual change summary for mutate_artifact', () => {
      const summary = getFrameCleanSummary({
        t: 'patch',
        op: 'mutate_artifact',
        target: 'shape:art_1',
        title: 'DSA Core 53',
        w: 960,
        h: 680,
      });

      expect(summary).toContain('Updated');
      expect(summary).toContain('DSA Core 53');
      expect(summary).toContain('undo');
      expect(summary).not.toContain('Liquid Glass');
      expect(summary).not.toContain('tested');
    });

    it('returns a factual change summary for spawn_artifact', () => {
      const summary = getFrameCleanSummary({
        t: 'patch',
        op: 'spawn_artifact',
        title: 'Neural Network Playground',
        w: 800,
        h: 540,
      });

      expect(summary).toContain('Created');
      expect(summary).toContain('Neural Network Playground');
      expect(summary).toContain('undo');
    });
  });
});
