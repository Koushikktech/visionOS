// Spatial Engine & Protocol Streamer Web Worker
// Handles RBush 2D R-Tree spatial indexing, Kiwi.js Cassowary geometric constraint solving,
// and real-time NDJSON streaming token state machines for sub-150ms first-movement latency.

import RBush from 'rbush';
import { Solver, Variable, Expression, Constraint, Operator, Strength } from 'kiwi.js';
import { stripMarkdownFences } from '../lib/sanitizeHtml';
import type {
  SpatialNodeItem,
  SpatialActionFrame,
  WorkerInMessage,
  WorkerOutMessage,
  DAGExecutionPlan,
  SolvedNodeCoordinate,
  SolvedGroupItem,
  SolvedConnectorItem,
  SolvedTextMutation,
  SolvedCreatedCard,
  SolvedRichCardItem,
  SolvedCodeCardItem,
  SolvedMediaEmbedItem,
  SolvedVectorItem,
  SolvedDocItem,
  DocSection,
  CardArchetype,
  SolvedArtifactItem,
  SolvedRestyle,
  SolvedActionPayload,
  SpeculativeSkeletonBounds,
  ViewportQuery,
  CulledContextPayload,
  BoundingBox,
} from '../types/spatial';

class SpatialIndex extends RBush<SpatialNodeItem> {
  toBBox(item: SpatialNodeItem) {
    return {
      minX: item.minX,
      minY: item.minY,
      maxX: item.maxX,
      maxY: item.maxY,
    };
  }

  compareMinX(a: SpatialNodeItem, b: SpatialNodeItem) {
    return a.minX - b.minX;
  }

  compareMinY(a: SpatialNodeItem, b: SpatialNodeItem) {
    return a.minY - b.minY;
  }
}

const tree = new SpatialIndex();
const nodeMap = new Map<string, SpatialNodeItem>();

// Active streaming sessions state
interface StreamSessionState {
  buffer: string;
  frameCount: number;
  startTime: number;
  viewportCenter?: { x: number; y: number };
  lastCreatedX?: number;
  lastCreatedY?: number;
  lastCreatedW?: number;
  lastCreatedH?: number;
  rowStartX?: number;
}
const activeSessions = new Map<string, StreamSessionState>();

/**
 * Re-indexes all shapes in the RBush spatial index without wiping in-progress turn nodes
 */
function syncIndex(nodes: SpatialNodeItem[]): number {
  for (const node of nodes) {
    const cleanId = node.id.replace(/^shape:/, '');
    nodeMap.set(node.id, node);
    nodeMap.set(cleanId, node);
    nodeMap.set(`shape:${cleanId}`, node);
  }
  tree.clear();
  tree.load(Array.from(new Set(nodeMap.values())));
  return nodeMap.size;
}

/**
 * Updates an internal node's position in nodeMap and reindexes in tree
 */
function updateInternalNodePosition(id: string, x: number, y: number, w?: number, h?: number) {
  const existing = nodeMap.get(id);
  if (!existing) return;

  const currentW = w ?? (existing.maxX - existing.minX);
  const currentH = h ?? (existing.maxY - existing.minY);

  const updated: SpatialNodeItem = {
    ...existing,
    minX: x,
    minY: y,
    maxX: x + currentW,
    maxY: y + currentH,
  };

  nodeMap.set(id, updated);
}

/**
 * Solves speculative skeleton placement bounds
 */
function solveSpeculativeSkeleton(
  frame: SpatialActionFrame,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState
): SpeculativeSkeletonBounds {
  const isArtifact = (frame as any).modality === 'SANDBOX_ARTIFACT' || frame.op === 'speculative_skeleton' || frame.op === 'spawn_artifact';
  const defaultW = isArtifact ? 780 : 320;
  const defaultH = isArtifact ? 540 : 180;
  const w = frame.bounds?.w || frame.w || defaultW;
  const h = frame.bounds?.h || frame.h || defaultH;
  let targetX = frame.bounds?.x;
  let targetY = frame.bounds?.y;

  if (targetX === undefined || targetY === undefined || (targetX === 0 && targetY === 0 && !frame.relative)) {
    if (frame.relative?.startsWith('right_of:')) {
      const anchorId = frame.relative.replace('right_of:', '');
      const anchor = nodeMap.get(anchorId);
      if (anchor) {
        targetX = anchor.maxX + (frame.margin ?? 40);
        targetY = anchor.minY;
      }
    } else if (session?.lastCreatedX !== undefined && session?.lastCreatedY !== undefined) {
      targetX = session.lastCreatedX + w + (frame.margin ?? 40);
      targetY = session.lastCreatedY;
    } else if (viewportCenter?.x !== undefined && viewportCenter?.y !== undefined) {
      targetX = Math.round(viewportCenter.x - w / 2);
      targetY = Math.round(viewportCenter.y - h / 2);
    } else {
      targetX = 0;
      targetY = 0;
    }
  }

  const resolvedX = targetX ?? 0;
  const resolvedY = targetY ?? 0;

  if (session) {
    session.lastCreatedX = resolvedX;
    session.lastCreatedY = resolvedY;
  }

  return {
    id: frame.id || `skel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: frame.title || (isArtifact ? 'Synthesizing Live App...' : 'Speculative Container'),
    x: resolvedX,
    y: resolvedY,
    w,
    h,
    statusText: isArtifact ? 'Synthesizing Live App...' : 'Planning container...',
  };
}

/**
 * Resolves smart 2D coordinates with full relative anchoring, turn layout flow, and R-Tree collision avoidance
 */
function findCollisionFreePosition(
  cardW: number,
  cardH: number,
  relative?: string,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState,
  margin = 120
): { x: number; y: number } {
  let targetX = viewportCenter?.x ? viewportCenter.x - cardW / 2 : 0;
  let targetY = viewportCenter?.y ? viewportCenter.y - cardH / 2 : 0;
  let hasExplicitAnchor = false;

  if (relative && relative !== 'center') {
    const clean = relative.trim();
    if (clean.startsWith('right_of:')) {
      const anchorId = clean.replace('right_of:', '').trim();
      const anchor = nodeMap.get(anchorId) || nodeMap.get(`shape:${anchorId}`) || nodeMap.get(anchorId.replace(/^shape:/, ''));
      if (anchor) {
        targetX = anchor.maxX + margin;
        targetY = anchor.minY;
        hasExplicitAnchor = true;
      }
    } else if (clean.startsWith('below:')) {
      const anchorId = clean.replace('below:', '').trim();
      const anchor = nodeMap.get(anchorId) || nodeMap.get(`shape:${anchorId}`) || nodeMap.get(anchorId.replace(/^shape:/, ''));
      if (anchor) {
        targetX = anchor.minX;
        targetY = anchor.maxY + (margin > 80 ? 100 : margin);
        hasExplicitAnchor = true;
      }
    } else if (clean.startsWith('left_of:')) {
      const anchorId = clean.replace('left_of:', '').trim();
      const anchor = nodeMap.get(anchorId) || nodeMap.get(`shape:${anchorId}`) || nodeMap.get(anchorId.replace(/^shape:/, ''));
      if (anchor) {
        targetX = anchor.minX - cardW - margin;
        targetY = anchor.minY;
        hasExplicitAnchor = true;
      }
    } else if (clean.startsWith('above:')) {
      const anchorId = clean.replace('above:', '').trim();
      const anchor = nodeMap.get(anchorId) || nodeMap.get(`shape:${anchorId}`) || nodeMap.get(anchorId.replace(/^shape:/, ''));
      if (anchor) {
        targetX = anchor.minX;
        targetY = anchor.minY - cardH - (margin > 80 ? 100 : margin);
        hasExplicitAnchor = true;
      }
    } else if (clean.startsWith('next_to:')) {
      const anchorId = clean.replace('next_to:', '').trim();
      const anchor = nodeMap.get(anchorId) || nodeMap.get(`shape:${anchorId}`) || nodeMap.get(anchorId.replace(/^shape:/, ''));
      if (anchor) {
        targetX = anchor.maxX + margin;
        targetY = anchor.minY;
        hasExplicitAnchor = true;
      }
    }
  }

  // If no explicit anchor matched, use turn session continuous flow
  if (!hasExplicitAnchor && session && session.lastCreatedX !== undefined && session.lastCreatedY !== undefined) {
    const cardGap = 120;
    const initialCenterX = viewportCenter?.x ? viewportCenter.x - cardW / 2 : 0;
    if (session.rowStartX === undefined) session.rowStartX = initialCenterX;

    const currentSpan = (session.lastCreatedX - session.rowStartX) + (session.lastCreatedW || cardW);

    if (currentSpan + cardW + cardGap > 1500) {
      targetX = session.rowStartX;
      targetY = session.lastCreatedY + (session.lastCreatedH || cardH) + 100;
    } else {
      targetX = session.lastCreatedX + (session.lastCreatedW || cardW) + cardGap;
      targetY = session.lastCreatedY;
    }
  }

  // R-Tree Collision Detection & Open-Space Shifting
  let iterations = 0;
  while (iterations < 10) {
    const searchBox = {
      minX: targetX - 10,
      minY: targetY - 10,
      maxX: targetX + cardW + 10,
      maxY: targetY + cardH + 10,
    };
    const colliders = tree.search(searchBox).filter((item) => item.type !== 'frame');
    if (colliders.length === 0) break;

    // Shift to the right of the colliding cluster
    const maxColliderX = Math.max(...colliders.map((c) => c.maxX));
    targetX = maxColliderX + margin;
    iterations++;
  }

  if (session) {
    if (session.rowStartX === undefined) session.rowStartX = targetX;
    session.lastCreatedX = targetX;
    session.lastCreatedY = targetY;
    session.lastCreatedW = cardW;
    session.lastCreatedH = cardH;
    session.frameCount = (session.frameCount || 0) + 1;
  }

  return { x: targetX, y: targetY };
}

/**
 * Calculates geometric coordinates and collision-free bounds for a newly spawned card
 */
function solveCreateCard(
  frame: SpatialActionFrame,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState
): SolvedCreatedCard {
  const cardId = frame.id || `card_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const cardW = frame.w || 260;
  const cardH = frame.h || 150;

  const { x: targetX, y: targetY } = findCollisionFreePosition(
    cardW,
    cardH,
    frame.relative,
    viewportCenter,
    session,
    frame.margin ?? 120
  );

  const createdCard: SolvedCreatedCard = {
    id: cardId,
    x: targetX,
    y: targetY,
    w: cardW,
    h: cardH,
    title: frame.title || frame.text || 'Card',
    text: frame.text,
    color: frame.color || 'light-violet',
    shapeType: frame.shapeType === 'artifact' ? 'artifact' : frame.shapeType === 'note' ? 'note' : 'geo',
  };

  const nodeItem: SpatialNodeItem = {
    id: cardId,
    type: createdCard.shapeType || 'geo',
    minX: targetX,
    minY: targetY,
    maxX: targetX + cardW,
    maxY: targetY + cardH,
    text: createdCard.title,
    color: createdCard.color,
  };
  nodeMap.set(cardId, nodeItem);
  nodeMap.set(cardId.replace(/^shape:/, ''), nodeItem);
  nodeMap.set(`shape:${cardId.replace(/^shape:/, '')}`, nodeItem);
  tree.insert(nodeItem);

  return createdCard;
}

/**
 * Calculates geometric coordinates and adaptive bounds for creating a Rich Card (KaTeX / Markdown)
 */
function solveCreateRichCard(
  frame: SpatialActionFrame,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState
): SolvedRichCardItem {
  const cardId = frame.id || `rich_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const archetype: CardArchetype = frame.archetype || 'note';

  // Base dimensions by archetype
  let defaultW = 480;
  let defaultH = 280;

  if (archetype === 'idea') {
    defaultW = 340;
    defaultH = 220;
  } else if (archetype === 'research') {
    defaultW = 580;
    defaultH = 340;
  } else if (archetype === 'comparison') {
    defaultW = 640;
    defaultH = 320;
  } else if (archetype === 'prompt') {
    defaultW = 420;
    defaultH = 220;
  }

  // Adjust height dynamically based on content length
  const content = frame.content || frame.text || '';
  if (content.length > 250) {
    defaultH = Math.min(640, defaultH + Math.floor((content.length - 250) / 2.5));
  }

  const cardW = frame.w || defaultW;
  const cardH = frame.h || defaultH;

  const { x: targetX, y: targetY } = findCollisionFreePosition(
    cardW,
    cardH,
    frame.relative,
    viewportCenter,
    session,
    frame.margin ?? 120
  );

  const richCard: SolvedRichCardItem = {
    id: cardId,
    x: targetX,
    y: targetY,
    w: cardW,
    h: cardH,
    title: frame.title || 'Rich Note',
    content: content,
    archetype: archetype,
    color: frame.color || 'light-blue',
    tags: frame.tags,
    isStreaming: false,
  };

  const nodeItem: SpatialNodeItem = {
    id: cardId,
    type: 'rich_card',
    minX: targetX,
    minY: targetY,
    maxX: targetX + cardW,
    maxY: targetY + cardH,
    text: richCard.title,
    color: richCard.color,
  };
  nodeMap.set(cardId, nodeItem);
  nodeMap.set(cardId.replace(/^shape:/, ''), nodeItem);
  nodeMap.set(`shape:${cardId.replace(/^shape:/, '')}`, nodeItem);
  tree.insert(nodeItem);

  return richCard;
}

/**
 * Calculates geometric coordinates and layout for spawning a Code Viewer Card
 */
function solveCreateCodeCard(
  frame: SpatialActionFrame,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState
): SolvedCodeCardItem {
  const cardId = frame.id || `code_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  let defaultW = 540;
  let defaultH = 340;

  const codeText = frame.code || '';
  const lineCount = codeText.split('\n').length;
  if (lineCount > 12) {
    defaultH = Math.min(640, defaultH + (lineCount - 12) * 16);
  }

  const cardW = frame.w || defaultW;
  const cardH = frame.h || defaultH;

  const { x: targetX, y: targetY } = findCollisionFreePosition(
    cardW,
    cardH,
    frame.relative,
    viewportCenter,
    session,
    frame.margin ?? 120
  );

  const codeCard: SolvedCodeCardItem = {
    id: cardId,
    x: targetX,
    y: targetY,
    w: cardW,
    h: cardH,
    title: frame.title || 'code_snippet',
    language: frame.language || 'javascript',
    code: codeText,
    description: frame.description,
    color: frame.color || 'light-blue',
    isStreaming: false,
  };

  const nodeItem: SpatialNodeItem = {
    id: cardId,
    type: 'code_card',
    minX: targetX,
    minY: targetY,
    maxX: targetX + cardW,
    maxY: targetY + cardH,
    title: codeCard.title,
    code: codeCard.code,
    language: codeCard.language,
    description: codeCard.description,
    color: codeCard.color,
  };
  nodeMap.set(cardId, nodeItem);
  nodeMap.set(cardId.replace(/^shape:/, ''), nodeItem);
  nodeMap.set(`shape:${cardId.replace(/^shape:/, '')}`, nodeItem);
  tree.insert(nodeItem);

  return codeCard;
}

/**
 * Calculates geometric coordinates and layout for spawning a Longform Document (Notion grade)
 */
function solveCreateDocument(
  frame: SpatialActionFrame,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState
): SolvedDocItem {
  const docId = frame.id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const cardW = frame.w || 680;
  const cardH = frame.h || 520;

  const { x: targetX, y: targetY } = findCollisionFreePosition(
    cardW,
    cardH,
    frame.relative,
    viewportCenter,
    session,
    frame.margin ?? 120
  );

  const docItem: SolvedDocItem = {
    id: docId,
    x: targetX,
    y: targetY,
    w: cardW,
    h: cardH,
    title: frame.title || 'Document',
    subtitle: frame.subtitle,
    author: frame.author || 'CanvasOS AI',
    date: frame.date || 'September 2026',
    sections: frame.sections || [
      {
        id: 'sec_1',
        title: 'Introduction',
        content: 'Document initialized on CanvasOS.',
      },
    ],
  };

  const nodeItem: SpatialNodeItem = {
    id: docId,
    type: 'document',
    minX: targetX,
    minY: targetY,
    maxX: targetX + cardW,
    maxY: targetY + cardH,
    title: docItem.title,
    subtitle: docItem.subtitle,
    author: docItem.author,
    date: docItem.date,
    sections: docItem.sections,
  };
  nodeMap.set(docId, nodeItem);
  nodeMap.set(docId.replace(/^shape:/, ''), nodeItem);
  nodeMap.set(`shape:${docId.replace(/^shape:/, '')}`, nodeItem);
  tree.insert(nodeItem);

  return docItem;
}

/**
 * Calculates geometric coordinates for spawning an interactive code artifact
 */
function solveSpawnArtifact(
  frame: SpatialActionFrame,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState
): SolvedArtifactItem {
  const artifactId = frame.id || `art_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const w = frame.bounds?.w || frame.w || 780;
  const h = frame.bounds?.h || frame.h || 540;

  let targetX = frame.bounds?.x;
  let targetY = frame.bounds?.y;

  if (targetX === undefined || targetY === undefined || (targetX === 0 && targetY === 0 && !frame.relative)) {
    const solved = findCollisionFreePosition(
      w,
      h,
      frame.relative,
      viewportCenter,
      session,
      frame.margin ?? 120
    );
    targetX = solved.x;
    targetY = solved.y;
  }

  const defaultParticlePhysics = `<canvas id="c"></canvas>
<script>
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  function resize(){ c.width = window.innerWidth; c.height = window.innerHeight; }
  window.onresize = resize; resize();
  
  const particles = [];
  for(let i = 0; i < 45; i++) {
    particles.push({
      x: Math.random() * c.width,
      y: Math.random() * c.height,
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3,
      radius: Math.random() * 4 + 2,
      color: "hsl(" + (Math.random() * 60 + 220) + ", 85%, 65%)"
    });
  }

  let mouse = { x: -1000, y: -1000 };
  window.onmousemove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };

  function loop() {
    ctx.fillStyle = "rgba(11, 14, 28, 0.25)";
    ctx.fillRect(0, 0, c.width, c.height);

    for(let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if(p.x < 0 || p.x > c.width) p.vx *= -1;
      if(p.y < 0 || p.y > c.height) p.vy *= -1;

      // Mouse gravity/repulsion
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if(dist < 120 && dist > 0) {
        p.vx -= (dx / dist) * 0.4;
        p.vy -= (dy / dist) * 0.4;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Connect nearby particles
      for(let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const d2 = Math.hypot(p.x - p2.x, p.y - p2.y);
        if(d2 < 90) {
          ctx.strokeStyle = "rgba(129, 140, 248, " + (1 - d2/90)*0.4 + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(loop);
  }
  loop();
</script>`;

  const artifact: SolvedArtifactItem = {
    id: artifactId,
    x: targetX,
    y: targetY,
    w,
    h,
    title: frame.title || 'Interactive Sandbox',
    code: stripMarkdownFences(frame.code && frame.code.length > 20 ? frame.code : defaultParticlePhysics),
    color: frame.color || 'light-violet',
    storage: frame.storage || frame.initialStorage || {},
  };

  const nodeItem: SpatialNodeItem = {
    id: artifactId,
    type: 'artifact',
    minX: targetX,
    minY: targetY,
    maxX: targetX + w,
    maxY: targetY + h,
    text: artifact.title,
    color: artifact.color,
    storage: artifact.storage,
  };
  nodeMap.set(artifactId, nodeItem);
  nodeMap.set(artifactId.replace(/^shape:/, ''), nodeItem);
  nodeMap.set(`shape:${artifactId.replace(/^shape:/, '')}`, nodeItem);
  tree.insert(nodeItem);

  return artifact;
}

/**
 * Calculates geometric coordinates for spawning an embedded media shape (YouTube, web, audio)
 */
function solveEmbedMedia(
  frame: SpatialActionFrame,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState
): SolvedMediaEmbedItem {
  const mediaId = frame.id || `media_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const w = frame.w || 480;
  const h = frame.h || 320;

  const { x: targetX, y: targetY } = findCollisionFreePosition(
    w,
    h,
    frame.relative,
    viewportCenter,
    session,
    frame.margin ?? 120
  );

  const mediaItem: SolvedMediaEmbedItem = {
    id: mediaId,
    x: targetX,
    y: targetY,
    w,
    h,
    title: frame.title || 'Media Resource',
    url: frame.mediaUrl || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    mediaType: frame.mediaType || 'youtube',
    color: frame.color || 'light-blue',
  };

  const nodeItem: SpatialNodeItem = {
    id: mediaId,
    type: 'media_embed',
    minX: targetX,
    minY: targetY,
    maxX: targetX + w,
    maxY: targetY + h,
    title: mediaItem.title,
    mediaUrl: mediaItem.url,
    mediaType: mediaItem.mediaType,
    color: mediaItem.color,
  };
  nodeMap.set(mediaId, nodeItem);
  nodeMap.set(mediaId.replace(/^shape:/, ''), nodeItem);
  nodeMap.set(`shape:${mediaId.replace(/^shape:/, '')}`, nodeItem);
  tree.insert(nodeItem);

  return mediaItem;
}

/**
 * Calculates geometric coordinates for drawing architectural glyphs & procedural vector shapes
 */
function solveDrawVector(
  frame: SpatialActionFrame,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState
): SolvedVectorItem {
  const vectorId = frame.id || `vec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const w = frame.w || (frame.vectorType === 'database' || frame.vectorType === 'queue' ? 240 : 200);
  const h = frame.h || (frame.vectorType === 'database' ? 180 : 160);

  const { x: targetX, y: targetY } = findCollisionFreePosition(
    w,
    h,
    frame.relative,
    viewportCenter,
    session,
    frame.margin ?? 120
  );

  const vectorItem: SolvedVectorItem = {
    id: vectorId,
    x: targetX,
    y: targetY,
    w,
    h,
    title: frame.title || `${frame.vectorType || 'database'} Node`,
    vectorType: frame.vectorType || 'database',
    svgPath: frame.svgPath,
    label: frame.label || frame.title,
    color: frame.color || 'light-violet',
  };

  const nodeItem: SpatialNodeItem = {
    id: vectorId,
    type: 'vector_shape',
    minX: targetX,
    minY: targetY,
    maxX: targetX + w,
    maxY: targetY + h,
    title: vectorItem.title,
    vectorType: vectorItem.vectorType,
    svgPath: vectorItem.svgPath,
    label: vectorItem.label,
    color: vectorItem.color,
  };
  nodeMap.set(vectorId, nodeItem);
  nodeMap.set(vectorId.replace(/^shape:/, ''), nodeItem);
  nodeMap.set(`shape:${vectorId.replace(/^shape:/, '')}`, nodeItem);
  tree.insert(nodeItem);

  return vectorItem;
}

/**
 * Solves alignment constraints using Kiwi.js (Cassowary linear arithmetic solver)
 */
function solveAlign(
  nodeIds: string[],
  direction: 'horizontal' | 'vertical' | 'grid' = 'horizontal',
  margin = 28
): SolvedNodeCoordinate[] {
  const targetNodes: SpatialNodeItem[] = [];
  for (const id of nodeIds) {
    const n = nodeMap.get(id);
    if (n) targetNodes.push(n);
  }

  if (targetNodes.length === 0) return [];

  const results: SolvedNodeCoordinate[] = [];

  if (direction === 'horizontal') {
    targetNodes.sort((a, b) => a.minX - b.minX);

    const solver = new Solver();
    const xVars: Variable[] = [];
    const yVars: Variable[] = [];

    const baseY = targetNodes[0].minY;
    const startX = targetNodes[0].minX;

    for (let i = 0; i < targetNodes.length; i++) {
      const xVar = new Variable(`x_${i}`);
      const yVar = new Variable(`y_${i}`);
      xVars.push(xVar);
      yVars.push(yVar);

      solver.addConstraint(
        new Constraint(new Expression(yVar), Operator.Eq, new Expression(baseY), Strength.required)
      );

      if (i === 0) {
        solver.addConstraint(
          new Constraint(new Expression(xVar), Operator.Eq, new Expression(startX), Strength.required)
        );
      } else {
        const prevNode = targetNodes[i - 1];
        const prevW = prevNode.maxX - prevNode.minX;
        const expr = new Expression(xVars[i - 1], prevW + margin);
        solver.addConstraint(new Constraint(new Expression(xVar), Operator.Eq, expr, Strength.required));
      }
    }

    solver.updateVariables();

    for (let i = 0; i < targetNodes.length; i++) {
      const newX = xVars[i].value();
      const newY = yVars[i].value();
      results.push({
        id: targetNodes[i].id,
        x: newX,
        y: newY,
      });
      updateInternalNodePosition(targetNodes[i].id, newX, newY);
    }
  } else if (direction === 'vertical') {
    targetNodes.sort((a, b) => a.minY - b.minY);

    const solver = new Solver();
    const xVars: Variable[] = [];
    const yVars: Variable[] = [];

    const baseX = targetNodes[0].minX;
    const startY = targetNodes[0].minY;

    for (let i = 0; i < targetNodes.length; i++) {
      const xVar = new Variable(`x_${i}`);
      const yVar = new Variable(`y_${i}`);
      xVars.push(xVar);
      yVars.push(yVar);

      solver.addConstraint(
        new Constraint(new Expression(xVar), Operator.Eq, new Expression(baseX), Strength.required)
      );

      if (i === 0) {
        solver.addConstraint(
          new Constraint(new Expression(yVar), Operator.Eq, new Expression(startY), Strength.required)
        );
      } else {
        const prevNode = targetNodes[i - 1];
        const prevH = prevNode.maxY - prevNode.minY;
        const expr = new Expression(yVars[i - 1], prevH + margin);
        solver.addConstraint(new Constraint(new Expression(yVar), Operator.Eq, expr, Strength.required));
      }
    }

    solver.updateVariables();

    for (let i = 0; i < targetNodes.length; i++) {
      const newX = xVars[i].value();
      const newY = yVars[i].value();
      results.push({
        id: targetNodes[i].id,
        x: newX,
        y: newY,
      });
      updateInternalNodePosition(targetNodes[i].id, newX, newY);
    }
  } else if (direction === 'grid') {
    const cols = Math.max(1, Math.ceil(Math.sqrt(targetNodes.length)));
    const startX = Math.min(...targetNodes.map((n) => n.minX));
    const startY = Math.min(...targetNodes.map((n) => n.minY));

    const cellW = Math.max(...targetNodes.map((n) => n.maxX - n.minX));
    const cellH = Math.max(...targetNodes.map((n) => n.maxY - n.minY));

    for (let i = 0; i < targetNodes.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const newX = startX + col * (cellW + margin);
      const newY = startY + row * (cellH + margin);
      results.push({
        id: targetNodes[i].id,
        x: newX,
        y: newY,
      });
      updateInternalNodePosition(targetNodes[i].id, newX, newY);
    }
  }

  return results;
}

/**
 * Computes topological docking into a container or beside an anchor
 */
function solveDock(
  targetId: string,
  groupOrAnchorId: string,
  slot: 'top' | 'bottom' | 'left' | 'right' | 'center' = 'right',
  margin = 24
): SolvedNodeCoordinate[] {
  const target = nodeMap.get(targetId);
  const anchor = nodeMap.get(groupOrAnchorId);

  if (!target || !anchor) return [];

  const targetW = target.maxX - target.minX;
  const targetH = target.maxY - target.minY;
  const anchorW = anchor.maxX - anchor.minX;
  const anchorH = anchor.maxY - anchor.minY;

  let newX = target.minX;
  let newY = target.minY;

  switch (slot) {
    case 'top':
      newX = anchor.minX + (anchorW - targetW) / 2;
      newY = anchor.minY - targetH - margin;
      break;
    case 'bottom':
      newX = anchor.minX + (anchorW - targetW) / 2;
      newY = anchor.maxY + margin;
      break;
    case 'left':
      newX = anchor.minX - targetW - margin;
      newY = anchor.minY + (anchorH - targetH) / 2;
      break;
    case 'right':
      newX = anchor.maxX + margin;
      newY = anchor.minY + (anchorH - targetH) / 2;
      break;
    case 'center':
      newX = anchor.minX + (anchorW - targetW) / 2;
      newY = anchor.minY + (anchorH - targetH) / 2;
      break;
  }

  updateInternalNodePosition(targetId, newX, newY);
  return [{ id: targetId, x: newX, y: newY }];
}

/**
 * Repels colliding non-related nodes using RBush AABB collision detection & push-out vectors
 */
function solveRepel(anchorId: string, margin = 40): SolvedNodeCoordinate[] {
  const anchor = nodeMap.get(anchorId);
  if (!anchor) return [];

  const searchBox = {
    minX: anchor.minX - margin,
    minY: anchor.minY - margin,
    maxX: anchor.maxX + margin,
    maxY: anchor.maxY + margin,
  };

  const colliders = tree.search(searchBox).filter((item) => item.id !== anchorId);
  if (colliders.length === 0) return [];

  const results: SolvedNodeCoordinate[] = [];
  const anchorCenterX = (anchor.minX + anchor.maxX) / 2;
  const anchorCenterY = (anchor.minY + anchor.maxY) / 2;

  for (const node of colliders) {
    const nodeCenterX = (node.minX + node.maxX) / 2;
    const nodeCenterY = (node.minY + node.maxY) / 2;

    const dx = nodeCenterX - anchorCenterX;
    const dy = nodeCenterY - anchorCenterY;

    const nodeW = node.maxX - node.minX;
    const nodeH = node.maxY - node.minY;
    const anchorW = anchor.maxX - anchor.minX;
    const anchorH = anchor.maxY - anchor.minY;

    const minDistanceX = (anchorW + nodeW) / 2 + margin;
    const minDistanceY = (anchorH + nodeH) / 2 + margin;

    const overlapX = minDistanceX - Math.abs(dx);
    const overlapY = minDistanceY - Math.abs(dy);

    if (overlapX > 0 && overlapY > 0) {
      let shiftX = 0;
      let shiftY = 0;

      if (overlapX < overlapY) {
        shiftX = dx >= 0 ? overlapX : -overlapX;
      } else {
        shiftY = dy >= 0 ? overlapY : -overlapY;
      }

      const newX = node.minX + shiftX;
      const newY = node.minY + shiftY;
      results.push({ id: node.id, x: newX, y: newY });
      updateInternalNodePosition(node.id, newX, newY);
    }
  }

  return results;
}

/**
 * Calculates bounding box and container geometry for create_group operation
 */
function solveCreateGroup(
  id: string,
  title?: string,
  nodeIds?: string[],
  relative?: string
): SolvedGroupItem {
  let minX = 0;
  let minY = 0;
  let maxX = 480;
  let maxY = 320;

  const candidateNodes = (nodeIds && nodeIds.length > 0)
    ? nodeIds
        .map((nId) => nodeMap.get(nId) || nodeMap.get(`shape:${nId}`) || nodeMap.get(nId.replace(/^shape:/, '')))
        .filter((n): n is SpatialNodeItem => !!n)
    : Array.from(nodeMap.values()).filter((n) => n.type !== 'frame' && n.type !== 'arrow');

  if (candidateNodes.length > 0) {
    const padding = 48;
    const headerSpace = 60;
    minX = Math.min(...candidateNodes.map((n) => n.minX)) - padding;
    minY = Math.min(...candidateNodes.map((n) => n.minY)) - headerSpace;
    maxX = Math.max(...candidateNodes.map((n) => n.maxX)) + padding;
    maxY = Math.max(...candidateNodes.map((n) => n.maxY)) + padding;
  } else if (relative === 'right_of:selection') {
    const allNodes = Array.from(nodeMap.values()).filter((n) => n.type !== 'frame');
    if (allNodes.length > 0) {
      const maxGlobalX = Math.max(...allNodes.map((n) => n.maxX));
      const minGlobalY = Math.min(...allNodes.map((n) => n.minY));
      minX = maxGlobalX + 80;
      minY = minGlobalY;
      maxX = minX + 480;
      maxY = minY + 340;
    }
  }

  const groupItem: SolvedGroupItem = {
    id: id || `grp_${Date.now()}`,
    title: title || 'Container Frame',
    x: minX,
    y: minY,
    w: Math.max(340, maxX - minX),
    h: Math.max(220, maxY - minY),
    nodeIds,
  };

  nodeMap.set(groupItem.id, {
    id: groupItem.id,
    type: 'frame',
    minX: groupItem.x,
    minY: groupItem.y,
    maxX: groupItem.x + groupItem.w,
    maxY: groupItem.y + groupItem.h,
    text: groupItem.title,
  });

  return groupItem;
}

/**
 * Resolves a single SAP frame and returns the solved payload
 */
function solveSingleFrame(
  frame: SpatialActionFrame,
  viewportCenter?: { x: number; y: number },
  session?: StreamSessionState
): SolvedActionPayload {
  const start = performance.now();

  switch (frame.op) {
    case 'speculative_skeleton': {
      const skeleton = solveSpeculativeSkeleton(frame, viewportCenter || session?.viewportCenter, session);
      const duration = performance.now() - start;
      return {
        op: 'speculative_skeleton',
        skeleton,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Placed speculative skeleton: "${skeleton.title}"`,
        rawFrame: frame,
      };
    }

    case 'create_card': {
      const createdCard = solveCreateCard(frame, viewportCenter || session?.viewportCenter, session);
      const duration = performance.now() - start;
      return {
        op: 'create_card',
        createdCard,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Created card: "${createdCard.title}"`,
        rawFrame: frame,
      };
    }

    case 'create_rich_card': {
      const richCard = solveCreateRichCard(frame, viewportCenter || session?.viewportCenter, session);
      const duration = performance.now() - start;
      return {
        op: 'create_rich_card',
        richCard,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Created rich note (${richCard.archetype}): "${richCard.title}"`,
        rawFrame: frame,
      };
    }

    case 'create_code_card': {
      const codeCard = solveCreateCodeCard(frame, viewportCenter || session?.viewportCenter, session);
      const duration = performance.now() - start;
      return {
        op: 'create_code_card',
        codeCard,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Created code viewer (${codeCard.language}): "${codeCard.title}"`,
        rawFrame: frame,
      };
    }

    case 'mutate_code_card': {
      const target = frame.target || frame.id || '';
      const existing = nodeMap.get(target);
      const duration = performance.now() - start;
      const codeCard: SolvedCodeCardItem = {
        id: target,
        title: frame.title || existing?.title || 'code_snippet',
        language: frame.language || existing?.language || 'javascript',
        code: frame.code !== undefined ? frame.code : existing?.code || '',
        description: frame.description !== undefined ? frame.description : existing?.description,
        color: frame.color || existing?.color || 'light-blue',
        x: existing?.minX || 0,
        y: existing?.minY || 0,
        w: existing ? existing.maxX - existing.minX : 540,
        h: existing ? existing.maxY - existing.minY : 340,
        isStreaming: false,
      };
      if (existing) {
        existing.title = codeCard.title;
        existing.code = codeCard.code;
        existing.language = codeCard.language;
        existing.description = codeCard.description;
        existing.color = codeCard.color;
        nodeMap.set(target, existing);
      }
      return {
        op: 'mutate_code_card',
        codeCard,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Updated code snippet: "${codeCard.title}"`,
        rawFrame: frame,
      };
    }

    case 'spawn_artifact': {
      const artifact = solveSpawnArtifact(frame, viewportCenter || session?.viewportCenter, session);
      const duration = performance.now() - start;
      return {
        op: 'spawn_artifact',
        artifact,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Spawned sandbox artifact: "${artifact.title}"`,
        rawFrame: frame,
      };
    }

    case 'mutate_artifact': {
      let target = frame.target || frame.id || '';
      let existing = nodeMap.get(target);

      if (!existing && target) {
        const cleanId = target.replace(/^shape:/, '');
        existing = nodeMap.get(cleanId) || nodeMap.get(`shape:${cleanId}`);
      }

      if (!existing || existing.type !== 'artifact') throw new Error('Artifact target no longer exists.');

      const duration = performance.now() - start;
      const artifact: SolvedArtifactItem = {
        id: target || existing?.id || `art_${Date.now()}`,
        title: frame.title || existing?.title || 'Interactive Sandbox',
        code: frame.code || existing?.code || '',
        color: frame.color || existing?.color || 'light-violet',
        storage: frame.storage || existing?.storage || {},
        x: existing?.minX ?? (viewportCenter?.x ? viewportCenter.x - 390 : 0),
        y: existing?.minY ?? (viewportCenter?.y ? viewportCenter.y - 270 : 0),
        w: frame.w || (existing ? existing.maxX - existing.minX : 780),
        h: frame.h || (existing ? existing.maxY - existing.minY : 540),
      };
      if (existing) {
        existing.title = artifact.title;
        existing.code = artifact.code;
        existing.color = artifact.color;
        existing.storage = artifact.storage;
        if (frame.w) existing.maxX = existing.minX + frame.w;
        if (frame.h) existing.maxY = existing.minY + frame.h;
        nodeMap.set(target, existing);
      }
      return {
        op: 'mutate_artifact',
        artifact,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Updated sandbox simulation: "${artifact.title}"`,
        rawFrame: frame,
      };
    }

    case 'embed_media': {
      const mediaEmbed = solveEmbedMedia(frame, viewportCenter || session?.viewportCenter, session);
      const duration = performance.now() - start;
      return {
        op: 'embed_media',
        mediaEmbed,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Embedded media (${mediaEmbed.mediaType}): "${mediaEmbed.title}"`,
        rawFrame: frame,
      };
    }

    case 'mutate_media': {
      const target = frame.target || frame.id || '';
      const existing = nodeMap.get(target);
      const duration = performance.now() - start;
      const mediaEmbed: SolvedMediaEmbedItem = {
        id: target,
        title: frame.title || existing?.title || 'Media Resource',
        url: frame.mediaUrl || existing?.mediaUrl || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        mediaType: frame.mediaType || existing?.mediaType || 'youtube',
        color: frame.color || existing?.color || 'light-blue',
        x: existing?.minX || 0,
        y: existing?.minY || 0,
        w: existing ? existing.maxX - existing.minX : 480,
        h: existing ? existing.maxY - existing.minY : 320,
      };
      if (existing) {
        existing.title = mediaEmbed.title;
        existing.mediaUrl = mediaEmbed.url;
        existing.mediaType = mediaEmbed.mediaType;
        existing.color = mediaEmbed.color;
        nodeMap.set(target, existing);
      }
      return {
        op: 'mutate_media',
        mediaEmbed,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Updated media resource: "${mediaEmbed.title}"`,
        rawFrame: frame,
      };
    }

    case 'draw_vector': {
      const vector = solveDrawVector(frame, viewportCenter || session?.viewportCenter, session);
      const duration = performance.now() - start;
      return {
        op: 'draw_vector',
        vector,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Drawn vector glyph (${vector.vectorType}): "${vector.title}"`,
        rawFrame: frame,
      };
    }

    case 'mutate_vector': {
      const target = frame.target || frame.id || '';
      const existing = nodeMap.get(target);
      const duration = performance.now() - start;
      const vector: SolvedVectorItem = {
        id: target,
        title: frame.title || existing?.title || 'Vector Glyph',
        vectorType: frame.vectorType || existing?.vectorType || 'database',
        svgPath: frame.svgPath !== undefined ? frame.svgPath : existing?.svgPath,
        label: frame.label !== undefined ? frame.label : existing?.label,
        color: frame.color || existing?.color || 'light-violet',
        x: existing?.minX || 0,
        y: existing?.minY || 0,
        w: existing ? existing.maxX - existing.minX : 240,
        h: existing ? existing.maxY - existing.minY : 180,
      };
      if (existing) {
        existing.title = vector.title;
        existing.vectorType = vector.vectorType;
        existing.svgPath = vector.svgPath;
        existing.label = vector.label;
        existing.color = vector.color;
        nodeMap.set(target, existing);
      }
      return {
        op: 'mutate_vector',
        vector,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Updated vector glyph: "${vector.title}"`,
        rawFrame: frame,
      };
    }

    case 'create_document': {
      const document = solveCreateDocument(frame, viewportCenter || session?.viewportCenter, session);
      const duration = performance.now() - start;
      return {
        op: 'create_document',
        document,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Created document (${document.sections.length} sections): "${document.title}"`,
        rawFrame: frame,
      };
    }

    case 'mutate_document': {
      const target = frame.target || frame.id || '';
      const existing = nodeMap.get(target);
      const duration = performance.now() - start;
      const docItem: SolvedDocItem = {
        id: target,
        title: frame.title || existing?.title || 'Document',
        subtitle: frame.subtitle !== undefined ? frame.subtitle : existing?.subtitle,
        author: frame.author !== undefined ? frame.author : existing?.author,
        date: frame.date !== undefined ? frame.date : existing?.date,
        sections: frame.sections || existing?.sections || [],
        x: existing?.minX || 0,
        y: existing?.minY || 0,
        w: existing ? existing.maxX - existing.minX : 680,
        h: existing ? existing.maxY - existing.minY : 520,
      };
      if (existing) {
        existing.title = docItem.title;
        existing.subtitle = docItem.subtitle;
        existing.author = docItem.author;
        existing.date = docItem.date;
        existing.sections = docItem.sections;
        nodeMap.set(target, existing);
      }
      return {
        op: 'mutate_document',
        document: docItem,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Updated document: "${docItem.title}"`,
        rawFrame: frame,
      };
    }

    case 'mutate_rich_card': {
      const target = frame.target || frame.id || '';
      const existing = nodeMap.get(target);
      const duration = performance.now() - start;
      const richCard: SolvedRichCardItem = {
        id: target,
        title: frame.title || existing?.title || 'Rich Note',
        content: frame.content !== undefined ? frame.content : existing?.content || '',
        archetype: frame.archetype || existing?.archetype || 'note',
        color: frame.color || existing?.color || 'light-blue',
        x: existing?.minX || 0,
        y: existing?.minY || 0,
        w: existing ? existing.maxX - existing.minX : 480,
        h: existing ? existing.maxY - existing.minY : 320,
        isStreaming: false,
      };
      if (existing) {
        existing.title = richCard.title;
        existing.content = richCard.content;
        existing.archetype = richCard.archetype;
        existing.color = richCard.color;
        nodeMap.set(target, existing);
      }
      return {
        op: 'mutate_rich_card',
        richCard,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Updated rich note: "${richCard.title}"`,
        rawFrame: frame,
      };
    }

    case 'move_shape':
    case 'resize_shape': {
      const existing = nodeMap.get(frame.target!);
      if (!existing) throw new Error('Target no longer exists.');
      const x=frame.x ?? existing.minX, y=frame.y ?? existing.minY;
      const w=frame.w ?? existing.maxX-existing.minX,h=frame.h ?? existing.maxY-existing.minY;
      Object.assign(existing,{minX:x,minY:y,maxX:x+w,maxY:y+h});
      return {op:frame.op,nodes:[{id:existing.id,x,y,
        ...(frame.op === 'resize_shape' ? {w:frame.w,h:frame.h} : {})}], executionTimeMs:0,actionSummary:'Updated geometry',rawFrame:frame};
    }
    case 'align': {
      const ids = frame.nodeIds || (frame.target ? [frame.target] : []);
      const coords = solveAlign(ids, frame.direction || 'horizontal', frame.margin ?? 28);
      const duration = performance.now() - start;
      return {
        op: 'align',
        nodes: coords,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Aligned ${coords.length} nodes (${frame.direction || 'horizontal'})`,
        rawFrame: frame,
      };
    }

    case 'dock_into': {
      if (frame.target && frame.group) {
        const coords = solveDock(frame.target, frame.group, frame.slot || 'right', frame.margin ?? 24);
        const duration = performance.now() - start;
        return {
          op: 'dock_into',
          nodes: coords,
          executionTimeMs: Number(duration.toFixed(2)),
          actionSummary: `Docked node ${frame.target} to ${frame.slot || 'right'}`,
          rawFrame: frame,
        };
      }
      break;
    }

    case 'repel_colliding': {
      const anchor = frame.anchor || frame.id || frame.target || '';
      if (anchor) {
        const coords = solveRepel(anchor, frame.margin ?? 40);
        const duration = performance.now() - start;
        return {
          op: 'repel_colliding',
          nodes: coords,
          executionTimeMs: Number(duration.toFixed(2)),
          actionSummary: `Repelled ${coords.length} colliding elements`,
          rawFrame: frame,
        };
      }
      break;
    }

    case 'create_group': {
      const groupId = frame.id || `grp_${Date.now()}`;
      const group = solveCreateGroup(groupId, frame.title, frame.nodeIds, frame.relative);
      const duration = performance.now() - start;
      return {
        op: 'create_group',
        group,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Created group frame: "${group.title}"`,
        rawFrame: frame,
      };
    }

    case 'connect': {
      if (frame.from && frame.to) {
        const connector: SolvedConnectorItem = {
          id: frame.id || `conn_${frame.from}_${frame.to}`,
          fromId: frame.from,
          toId: frame.to,
          label: frame.label,
          bend: frame.bend ?? 0,
          color: frame.color,
        };
        const duration = performance.now() - start;
        return {
          op: 'connect',
          connector,
          executionTimeMs: Number(duration.toFixed(2)),
          actionSummary: `Connected: ${frame.from} ➔ ${frame.to} ${frame.label ? `(${frame.label})` : ''}`,
          rawFrame: frame,
        };
      }
      break;
    }

    case 'mutate_text': {
      const target = frame.target || frame.id || '';
      if (target && frame.text !== undefined) {
        const textMutation: SolvedTextMutation = {
          id: target,
          text: frame.text,
          color: frame.color,
        };
        const duration = performance.now() - start;
        return {
          op: 'mutate_text',
          textMutation,
          executionTimeMs: Number(duration.toFixed(2)),
          actionSummary: `Updated text for ${target}`,
          rawFrame: frame,
        };
      }
      break;
    }

    case 'delete_shape': {
      const target = frame.target || frame.id || '';
      const ids = frame.nodeIds || (target ? [target] : []);
      for (const id of ids) {
        nodeMap.delete(id);
      }
      const duration = performance.now() - start;
      return {
        op: 'delete_shape',
        deletedIds: ids,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Deleted ${ids.length} shapes`,
        rawFrame: frame,
      };
    }

    case 'restyle_shape': {
      const target = frame.target || frame.id || '';
      const restyle: SolvedRestyle = {
        id: target,
        color: frame.color,
        fill: frame.fill,
      };
      const duration = performance.now() - start;
      return {
        op: 'restyle_shape',
        restyle,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Restyled ${target}`,
        rawFrame: frame,
      };
    }

    case 'focus_viewport': {
      const ids = frame.nodeIds || (frame.target ? [frame.target] : []);
      const duration = performance.now() - start;
      return {
        op: 'focus_viewport',
        focusIds: ids,
        executionTimeMs: Number(duration.toFixed(2)),
        actionSummary: `Focus camera on selection`,
        rawFrame: frame,
      };
    }

    default:
      break;
  }

  const duration = performance.now() - start;
  return {
    op: frame.op,
    executionTimeMs: Number(duration.toFixed(2)),
    actionSummary: `Processed ${frame.op}`,
    rawFrame: frame,
  };
}

/**
 * Handles incoming streaming chunk token state machine
 */
function handleStreamChunk(sessionId: string, chunk: string) {
  let session = activeSessions.get(sessionId);
  if (!session) {
    session = { buffer: '', frameCount: 0, startTime: performance.now() };
    activeSessions.set(sessionId, session);
  }

  session.buffer += chunk;

  let newlineIndex: number;
  while ((newlineIndex = session.buffer.indexOf('\n')) !== -1) {
    const line = session.buffer.slice(0, newlineIndex).trim();
    session.buffer = session.buffer.slice(newlineIndex + 1);

    if (line.length > 0) {
      try {
        let clean = line;
        if (clean.startsWith('```json')) clean = clean.slice(7).trim();
        if (clean.startsWith('```')) clean = clean.slice(3).trim();
        if (clean.endsWith('```')) clean = clean.slice(0, -3).trim();

        if (clean.startsWith('{') && clean.endsWith('}')) {
          const frame = JSON.parse(clean) as SpatialActionFrame;
          if (frame.t === 'patch' && frame.op) {
            const payload = solveSingleFrame(frame, session.viewportCenter, session);
            session.frameCount++;
            self.postMessage({
              type: 'STREAM_ACTION_SOLVED',
              sessionId,
              payload,
              frameIndex: session.frameCount,
            } satisfies WorkerOutMessage);
          }
        }
      } catch {
        // Partial chunk, ignore safely
      }
    }
  }
}

/**
 * Concludes a stream session
 */
function handleStreamEnd(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  const remaining = session.buffer.trim();
  if (remaining.length > 0) {
    try {
      const frame = JSON.parse(remaining) as SpatialActionFrame;
      if (frame.t === 'patch' && frame.op) {
        const payload = solveSingleFrame(frame, session.viewportCenter, session);
        session.frameCount++;
        self.postMessage({
          type: 'STREAM_ACTION_SOLVED',
          sessionId,
          payload,
          frameIndex: session.frameCount,
        } satisfies WorkerOutMessage);
      }
    } catch {
      // Ignored
    }
  }

  const totalDurationMs = Number((performance.now() - session.startTime).toFixed(2));
  self.postMessage({
    type: 'STREAM_COMPLETE',
    sessionId,
    totalFrames: session.frameCount,
    totalDurationMs,
  } satisfies WorkerOutMessage);

  activeSessions.delete(sessionId);
}

/**
 * Prunes the spatial canvas down to a concise <300 token payload for LLM context
 */
function cullViewport(viewport: ViewportQuery, selectedIds: string[] = []): CulledContextPayload {
  const selectedNodes: SpatialNodeItem[] = [];
  for (const id of selectedIds) {
    const node = nodeMap.get(id);
    if (node) selectedNodes.push(node);
  }

  const searchBox = {
    minX: viewport.minX,
    minY: viewport.minY,
    maxX: viewport.maxX,
    maxY: viewport.maxY,
  };

  const inViewport = tree.search(searchBox);
  const selectedSet = new Set(selectedIds);
  const viewportNeighbors = inViewport.filter((n) => !selectedSet.has(n.id));

  const outsideNodes = Array.from(nodeMap.values()).filter(
    (n) =>
      !selectedSet.has(n.id) &&
      (n.maxX < viewport.minX ||
        n.minX > viewport.maxX ||
        n.maxY < viewport.minY ||
        n.minY > viewport.maxY)
  );

  const macroClusters: Array<{
    id: string;
    label?: string;
    bounds: BoundingBox;
    childCount: number;
  }> = [];

  if (outsideNodes.length > 0) {
    const minX = Math.min(...outsideNodes.map((n) => n.minX));
    const minY = Math.min(...outsideNodes.map((n) => n.minY));
    const maxX = Math.max(...outsideNodes.map((n) => n.maxX));
    const maxY = Math.max(...outsideNodes.map((n) => n.maxY));

    macroClusters.push({
      id: 'cluster_out_of_view',
      label: 'Offscreen Macro Zone',
      bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      childCount: outsideNodes.length,
    });
  }

  const totalTokenEstimate =
    selectedNodes.length * 18 + viewportNeighbors.length * 12 + macroClusters.length * 15 + 20;

  return {
    selectedNodes,
    viewportNeighbors,
    macroClusters,
    totalTokenEstimate,
  };
}

// Worker Message Dispatcher
self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'SYNC_INDEX': {
        const count = syncIndex(msg.nodes);
        self.postMessage({ type: 'INDEX_SYNCED', count } satisfies WorkerOutMessage);
        break;
      }

      case 'RUN_ACTIONS': {
        const startTime = performance.now();
        const solvedActions: SolvedActionPayload[] = [];
        const solvedNodes: SolvedNodeCoordinate[] = [];
        const createdCards: SolvedCreatedCard[] = [];
        const richCards: SolvedRichCardItem[] = [];
        const codeCards: SolvedCodeCardItem[] = [];
        const artifacts: SolvedArtifactItem[] = [];
        const mediaEmbeds: SolvedMediaEmbedItem[] = [];
        const vectors: SolvedVectorItem[] = [];
        const documents: SolvedDocItem[] = [];
        const groups: SolvedGroupItem[] = [];
        const connectors: SolvedConnectorItem[] = [];
        const textMutations: SolvedTextMutation[] = [];
        const skeletons: SpeculativeSkeletonBounds[] = [];
        const restyles: SolvedRestyle[] = [];
        const deletedIds: string[] = [];
        const focusIds: string[] = [];

        if (activeSessions.size > 100) activeSessions.delete(activeSessions.keys().next().value!);
        const sessionId = msg.sessionId || 'default_turn_session';
        let batchSession = activeSessions.get(sessionId);
        if (!batchSession) {
          batchSession = {
            buffer: '',
            frameCount: 0,
            startTime,
            viewportCenter: msg.viewportCenter,
          };
          activeSessions.set(sessionId, batchSession);
        } else if (msg.viewportCenter) {
          batchSession.viewportCenter = msg.viewportCenter;
        }

        for (const action of msg.actions) {
          const solved = solveSingleFrame(action, msg.viewportCenter || batchSession.viewportCenter, batchSession);
          solvedActions.push(solved);
          if (solved.restyle) restyles.push(solved.restyle);
          if (solved.createdCard) createdCards.push(solved.createdCard);
          if (solved.richCard) richCards.push(solved.richCard);
          if (solved.codeCard) codeCards.push(solved.codeCard);
          if (solved.artifact) artifacts.push(solved.artifact);
          if (solved.mediaEmbed) mediaEmbeds.push(solved.mediaEmbed);
          if (solved.vector) vectors.push(solved.vector);
          if (solved.document) documents.push(solved.document);
          if (solved.nodes) solvedNodes.push(...solved.nodes);
          if (solved.group) groups.push(solved.group);
          if (solved.connector) connectors.push(solved.connector);
          if (solved.textMutation) textMutations.push(solved.textMutation);
          if (solved.skeleton) skeletons.push(solved.skeleton);
          if (solved.deletedIds) deletedIds.push(...solved.deletedIds);
          if (solved.focusIds) focusIds.push(...solved.focusIds);
        }

        const duration = performance.now() - startTime;
        self.postMessage({
          type: 'LAYOUT_SOLVED',
          requestId: msg.requestId,
          result: {
            actions: solvedActions,
            restyles,
            nodes: solvedNodes,
            createdCards,
            richCards,
            codeCards,
            artifacts,
            mediaEmbeds,
            vectors,
            documents,
            groups,
            connectors,
            textMutations,
            skeletons,
            deletedIds,
            focusIds,
            executionTimeMs: Number(duration.toFixed(2)),
            actionSummary: `Executed ${msg.actions.length} spatial actions`,
          },
        } satisfies WorkerOutMessage);
        break;
      }

      case 'SOLVE_DAG_PLAN': {
        const skeletons: SpeculativeSkeletonBounds[] = [];
        const batchSession: StreamSessionState = {
          buffer: '',
          frameCount: 0,
          startTime: performance.now(),
          viewportCenter: msg.viewportCenter,
        };

        for (const node of msg.plan.nodes) {
          const w = node.bounds?.w || (node.modality === 'SANDBOX_ARTIFACT' ? 780 : node.modality === 'VECTOR_DRAW' ? 240 : 480);
          const h = node.bounds?.h || (node.modality === 'SANDBOX_ARTIFACT' ? 540 : node.modality === 'VECTOR_DRAW' ? 180 : 340);

          const { x, y } = findCollisionFreePosition(
            w,
            h,
            node.relative,
            msg.viewportCenter,
            batchSession,
            44
          );

          skeletons.push({
            id: node.id,
            title: node.title,
            modality: node.modality,
            x,
            y,
            w,
            h,
            statusText: node.role || 'Specialist Task',
          });
        }

        self.postMessage({
          type: 'DAG_PLAN_SOLVED',
          plan: msg.plan,
          skeletons,
        } satisfies WorkerOutMessage);
        break;
      }

      case 'ALIGN_NODES': {
        const startTime = performance.now();
        const solved = solveAlign(msg.nodeIds, msg.direction, msg.margin);
        const duration = performance.now() - startTime;
        self.postMessage({
          type: 'LAYOUT_SOLVED',
          result: {
            nodes: solved,
            executionTimeMs: Number(duration.toFixed(2)),
            actionSummary: `Aligned ${solved.length} nodes (${msg.direction})`,
          },
        } satisfies WorkerOutMessage);
        break;
      }

      case 'DOCK_NODE': {
        const startTime = performance.now();
        const solved = solveDock(msg.targetId, msg.groupOrAnchorId, msg.slot, msg.margin);
        const duration = performance.now() - startTime;
        self.postMessage({
          type: 'LAYOUT_SOLVED',
          result: {
            nodes: solved,
            executionTimeMs: Number(duration.toFixed(2)),
            actionSummary: `Docked node ${msg.targetId} to ${msg.slot}`,
          },
        } satisfies WorkerOutMessage);
        break;
      }

      case 'REPEL_COLLISIONS': {
        const startTime = performance.now();
        const solved = solveRepel(msg.anchorId, msg.margin);
        const duration = performance.now() - startTime;
        self.postMessage({
          type: 'LAYOUT_SOLVED',
          result: {
            nodes: solved,
            executionTimeMs: Number(duration.toFixed(2)),
            actionSummary: `Repelled ${solved.length} colliding elements`,
          },
        } satisfies WorkerOutMessage);
        break;
      }

      case 'QUERY_VIEWPORT': {
        const culled = cullViewport(msg.viewport, msg.selectedIds);
        self.postMessage({
          type: 'VIEWPORT_CULLED',
          payload: culled,
        } satisfies WorkerOutMessage);
        break;
      }

      case 'STREAM_START': {
        activeSessions.set(msg.sessionId, {
          buffer: '',
          frameCount: 0,
          startTime: performance.now(),
          viewportCenter: msg.viewportCenter,
        });
        break;
      }

      case 'STREAM_CHUNK': {
        handleStreamChunk(msg.sessionId, msg.chunk);
        break;
      }

      case 'STREAM_FRAME': {
        const session = activeSessions.get(msg.sessionId);
        const payload = solveSingleFrame(msg.frame, session?.viewportCenter, session);
        if (session) session.frameCount++;
        self.postMessage({
          type: 'STREAM_ACTION_SOLVED',
          sessionId: msg.sessionId,
          payload,
          frameIndex: session?.frameCount ?? 1,
        } satisfies WorkerOutMessage);
        break;
      }

      case 'STREAM_END': {
        handleStreamEnd(msg.sessionId);
        break;
      }

      case 'STREAM_ABORT': {
        activeSessions.delete(msg.sessionId);
        break;
      }
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: 'ERROR', requestId: 'requestId' in msg ? msg.requestId : undefined, error } satisfies WorkerOutMessage);
  }
};
