import { createShapeId, toRichText } from '@tldraw/tldraw';
import type { Editor, TLPageId } from '@tldraw/tldraw';
import { assertCanvasWritable } from './canvasWriteGuard';
import { runEditorOperationSafely } from './editorOperation';

export type StudioExample = 'field-notes' | 'brief-slides' | 'connections';

export const STUDIO_EXAMPLE_LABELS: Record<StudioExample, string> = {
  'field-notes': 'Field Notes',
  'brief-slides': 'Field Notes · Brief and slides',
  connections: 'Field Notes · Connections',
};

const TIMER_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Field Notes Focus Timer</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #202327; background: #f4f5f6; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 360px); text-align: center; }
    p { margin: 0; color: #606872; font-size: 14px; }
    h1 { margin: 8px 0 24px; font-size: 20px; font-weight: 600; }
    output { display: block; margin: 0 0 24px; font-size: clamp(48px, 16vw, 72px); font-variant-numeric: tabular-nums; letter-spacing: -.06em; }
    .controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
    button { min-width: 96px; min-height: 44px; border: 1px solid #c9cdd2; border-radius: 12px; padding: 0 16px; color: #202327; background: #fff; font: inherit; font-size: 14px; cursor: pointer; }
    button:focus-visible { outline: 2px solid #2454b8; outline-offset: 3px; }
    button.primary { border-color: #2454b8; color: #fff; background: #2454b8; }
    #status { min-height: 24px; margin-top: 18px; }
  </style>
</head>
<body>
  <main aria-labelledby="title">
    <p>FIELD NOTES · FOCUS SESSION</p>
    <h1 id="title">A little time to notice</h1>
    <output id="clock" aria-label="Time remaining">25:00</output>
    <div class="controls">
      <button id="start" class="primary" type="button">Start</button>
      <button id="reset" type="button">Reset</button>
    </div>
    <p id="status" role="status" aria-live="polite">Ready when you are.</p>
  </main>
  <script>
    (() => {
      const clock = document.getElementById('clock');
      const status = document.getElementById('status');
      const start = document.getElementById('start');
      const reset = document.getElementById('reset');
      const sessionLength = 25 * 60;
      let remaining = sessionLength;
      let interval = null;
      const render = () => {
        const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
        const seconds = (remaining % 60).toString().padStart(2, '0');
        clock.textContent = minutes + ':' + seconds;
        clock.setAttribute('aria-label', minutes + ' minutes ' + seconds + ' seconds remaining');
      };
      const pause = () => {
        if (interval !== null) window.clearInterval(interval);
        interval = null;
        start.textContent = 'Resume';
      };
      start.addEventListener('click', () => {
        if (interval !== null) {
          pause();
          status.textContent = 'Paused. Pick up when you are ready.';
          return;
        }
        if (remaining <= 0) remaining = sessionLength;
        start.textContent = 'Pause';
        status.textContent = 'A quiet focus session is underway.';
        interval = window.setInterval(() => {
          remaining = Math.max(0, remaining - 1);
          render();
          if (remaining === 0) {
            pause();
            start.textContent = 'Start again';
            status.textContent = 'Session complete. Take a breath.';
          }
        }, 1000);
      });
      reset.addEventListener('click', () => {
        pause();
        remaining = sessionLength;
        render();
        start.textContent = 'Start';
        status.textContent = 'Ready when you are.';
      });
      render();
    })();
  </script>
</body>
</html>`;

const FIELD_SECTIONS = [
  {
    id: 'question',
    title: 'The question',
    badge: 'Field brief',
    content: 'How might a short walk make room for closer attention?\n\nField Notes is a small practice for recording what a place feels like, then carrying one useful observation into the next day.',
  },
  {
    id: 'field-log',
    title: 'Field log',
    badge: 'Next walk',
    content: 'Start at the footbridge. Pause at the lookout for five minutes. Record one sound, one change in light, and one detail that was easy to miss.\n\nKeep the session gentle: notice first, organize later.',
  },
];

const FIELD_SLIDES = [
  {
    id: 'place',
    title: 'Field Notes',
    subtitle: 'A small practice for paying attention',
    layout: 'hero',
    content: 'A walk, a few observations, and one idea to carry forward.',
    speakerNotes: 'Introduce the practice as an invitation, not a productivity target.',
  },
  {
    id: 'practice',
    title: 'Make room to notice',
    subtitle: 'A simple field session',
    layout: 'split',
    columns: [
      { title: 'Go slowly', text: 'Choose a familiar route and leave space to pause.', icon: '01' },
      { title: 'Record one thing', text: 'Capture a sound, a shift in light, or a small detail.', icon: '02' },
    ],
  },
  {
    id: 'carry-forward',
    title: 'Carry one detail forward',
    subtitle: 'The next step can stay small',
    layout: 'takeaway',
    bullets: ['Keep the useful observation close.', 'Let the next walk begin with curiosity.'],
  },
];

function stableHash(value: string): string {
  // Two independent 32-bit FNV-style lanes keep generated record IDs compact
  // while making page and shape identities stable across mounts and reloads.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(36)}${second.toString(36)}`;
}

function examplePageId(intentId: string): TLPageId {
  return `page:studio-example-${stableHash(intentId)}` as TLPageId;
}

function exampleShapeId(intentId: string, name: string) {
  return createShapeId(`studio-example-${stableHash(intentId)}-${name}`);
}

function assertIntent(intentId: string): void {
  if (!intentId.trim()) throw new Error('A sample insertion intent is required.');
}

function createBrief(editor: Editor, intentId: string, position: { x: number; y: number }) {
  editor.createShape({
    id: exampleShapeId(intentId, 'brief'),
    type: 'document',
    x: position.x,
    y: position.y,
    props: {
      w: 640,
      h: 520,
      title: 'Field Notes',
      subtitle: 'A practice of paying attention',
      author: 'Field Notes Studio',
      sections: FIELD_SECTIONS.map((section) => ({ ...section })),
      activeSectionId: 'question',
    },
  });
}

function createDeck(editor: Editor, intentId: string, position: { x: number; y: number }) {
  editor.createShape({
    id: exampleShapeId(intentId, 'presentation'),
    type: 'slide_deck',
    x: position.x,
    y: position.y,
    props: {
      w: 800,
      h: 500,
      title: 'Field Notes',
      subtitle: 'A small practice for paying attention',
      theme: 'paper',
      currentSlideIndex: 0,
      slides: FIELD_SLIDES.map((slide) => ({ ...slide })),
    },
  });
}

function createSketch(editor: Editor, intentId: string, x: number, y: number) {
  editor.createShape({
    id: exampleShapeId(intentId, 'timer-progress-sketch'),
    type: 'draw',
    x: x + 206,
    y: y + 108,
    props: {
      color: 'blue',
      fill: 'none',
      dash: 'draw',
      size: 'm',
      segments: [{
        type: 'free',
        points: [
          { x: 102, y: 8 }, { x: 127, y: 14 }, { x: 151, y: 28 },
          { x: 169, y: 48 }, { x: 179, y: 73 }, { x: 180, y: 99 },
          { x: 171, y: 124 }, { x: 154, y: 145 }, { x: 130, y: 160 },
          { x: 104, y: 166 }, { x: 78, y: 161 }, { x: 55, y: 147 },
          { x: 37, y: 126 }, { x: 27, y: 101 }, { x: 27, y: 76 },
          { x: 36, y: 53 }, { x: 52, y: 34 }, { x: 74, y: 20 },
        ],
      }],
      isComplete: true,
      isClosed: false,
      isPen: true,
      scale: 1,
    },
  });
  editor.createShape({
    id: exampleShapeId(intentId, 'timer-wireframe'),
    type: 'geo',
    x: x + 48,
    y: y + 32,
    props: { w: 548, h: 370, geo: 'rectangle', color: 'grey', fill: 'none', richText: toRichText('Focus session · 25 minutes') },
  });
  editor.createShape({
    id: exampleShapeId(intentId, 'timer-display-sketch'),
    type: 'geo',
    x: x + 232,
    y: y + 150,
    props: { w: 160, h: 78, geo: 'ellipse', color: 'blue', fill: 'none', richText: toRichText('25:00') },
  });
  editor.createShape({
    id: exampleShapeId(intentId, 'timer-start-sketch'),
    type: 'geo',
    x: x + 256,
    y: y + 292,
    props: { w: 112, h: 48, geo: 'rectangle', color: 'blue', fill: 'semi', richText: toRichText('Start') },
  });
}

function createFocusTimer(editor: Editor, intentId: string, x: number, y: number) {
  editor.createShape({
    id: exampleShapeId(intentId, 'focus-timer'),
    type: 'artifact',
    x,
    y,
    props: {
      w: 460,
      h: 420,
      title: 'Focus timer',
      code: TIMER_HTML,
      color: '#2454b8',
      storage: {},
      networkEnabled: false,
      runtimePaused: false,
    },
  });
}

function createConnections(editor: Editor, intentId: string) {
  const notes = [
    { key: 'notice', x: 80, y: 120, color: 'light-blue', text: 'Notice\n\nWhat changed in the light?' },
    { key: 'record', x: 500, y: 380, color: 'light-violet', text: 'Record\n\nKeep one detail in view.' },
    { key: 'return', x: 920, y: 120, color: 'light-green', text: 'Return\n\nLet the next walk start here.' },
  ] as const;
  for (const note of notes) {
    editor.createShape({
      id: exampleShapeId(intentId, note.key),
      type: 'note',
      x: note.x,
      y: note.y,
      props: { color: note.color, richText: toRichText(note.text) },
    });
  }

  const links = [
    { key: 'notice-to-record', from: notes[0], to: notes[1], label: 'save a detail' },
    { key: 'record-to-return', from: notes[1], to: notes[2], label: 'carry it forward' },
  ];
  for (const [index, link] of links.entries()) {
    const fromCenter = { x: link.from.x + 160, y: link.from.y + 92 };
    const toCenter = { x: link.to.x + 160, y: link.to.y + 92 };
    const arrowId = exampleShapeId(intentId, link.key);
    editor.createShape({
      id: arrowId,
      type: 'arrow',
      x: fromCenter.x,
      y: fromCenter.y,
      props: {
        start: { x: 0, y: 0 },
        end: { x: toCenter.x - fromCenter.x, y: toCenter.y - fromCenter.y },
        text: link.label,
        arrowheadEnd: 'arrow',
        color: index === 0 ? 'blue' : 'green',
        bend: 0,
        size: 's',
      },
    });
    for (const [terminal, note] of [['start', link.from], ['end', link.to]] as const) {
      editor.createBinding({
        type: 'arrow',
        fromId: arrowId,
        toId: exampleShapeId(intentId, note.key),
        props: {
          terminal,
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: false,
        },
      });
    }
  }
}

/**
 * Insert one authored example on a new page. The intent ID is the idempotency
 * key so retries and React remounts reopen the original sample page without
 * creating a second copy. All page, shape, and binding records share one
 * editor transaction and are undone together.
 */
export function insertStudioExample(editor: Editor, example: StudioExample, intentId: string): void {
  assertIntent(intentId);
  const pageId = examplePageId(intentId);
  const existing = editor.getPage(pageId);
  if (existing) {
    if (existing.meta.studioExample !== example) {
      throw new Error('This sample insertion intent already belongs to another example.');
    }
    editor.setCurrentPage(pageId);
    return;
  }

  const name = STUDIO_EXAMPLE_LABELS[example];
  if (!name) throw new Error(`Unknown Studio example: ${String(example)}`);

  assertCanvasWritable(editor);
  if (editor.getPages().length >= editor.options.maxPages) {
    throw new Error(`This workspace has reached its ${editor.options.maxPages}-page limit.`);
  }

  const rollbackMark = editor.markHistoryStoppingPoint('studio_example_insert');
  runEditorOperationSafely(editor, () => {
    editor.createPage({
      id: pageId,
      name,
      meta: { studioExample: example },
    });
    // tldraw intentionally no-ops once maxPages is reached. Check before
    // creating shapes so an example can never spill onto the previous page.
    if (!editor.getPage(pageId)) throw new Error('The sample page could not be created. Make room and try again.');
    editor.setCurrentPage(pageId);

    if (example === 'field-notes') {
      createSketch(editor, intentId, 40, 32);
      createFocusTimer(editor, intentId, 740, 28);
      createBrief(editor, intentId, { x: 40, y: 500 });
      createDeck(editor, intentId, { x: 740, y: 520 });
    } else if (example === 'brief-slides') {
      createBrief(editor, intentId, { x: 40, y: 64 });
      createDeck(editor, intentId, { x: 740, y: 64 });
    } else if (example === 'connections') {
      createConnections(editor, intentId);
    } else {
      throw new Error(`Unknown Studio example: ${String(example)}`);
    }
  }, rollbackMark, { attempted: false });

  editor.zoomToFit({ animation: { duration: 0 } });
}
