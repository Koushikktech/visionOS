import type { Editor, TLShape, TLShapeId } from '@tldraw/tldraw';
import type { BoundingBox, VisualSnapshot } from '@/types/spatial';
import { Solver, Variable, Expression, Constraint, Operator, Strength } from 'kiwi.js';

export interface CapturedVisionData {
  blob: Blob;
  dataUrl: string;
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  svg?: string;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    w: number;
    h: number;
  };
  shapeIds: string[];
  shapeSummaries: Array<{
    id: string;
    type: string;
    title?: string;
    text?: string;
    content?: string;
    code?: string;
    language?: string;
    color?: string;
    archetype?: string;
  }>;
  isSelection: boolean;
}

export interface GroundedSpatialContext {
  selectedCount: number;
  selectedShapes: Array<{
    id: string;
    type: string;
    title?: string;
    text?: string;
    content?: string;
    code?: string;
    language?: string;
    archetype?: string;
    color?: string;
    bounds?: BoundingBox;
    from?: string;
    to?: string;
  }>;
  visibleCount: number;
  zoom: number;
  zoomFormatted: string;
  center: { x: number; y: number };
  viewportBounds: BoundingBox;
  totalShapesCount: number;
}

/**
 * Extracts plain text from a tldraw v3 richText AST object ({ type: 'doc', content: [...] }) or string
 */
export function extractPlainTextFromRichText(richText: any): string | undefined {
  if (!richText) return undefined;
  if (typeof richText === 'string') return richText.trim();
  if (typeof richText === 'object' && Array.isArray(richText.content)) {
    const lines: string[] = [];
    for (const block of richText.content) {
      if (block && Array.isArray(block.content)) {
        const textParts = block.content
          .map((c: any) => (c && typeof c.text === 'string' ? c.text : ''))
          .join('');
        lines.push(textParts);
      } else if (typeof block?.text === 'string') {
        lines.push(block.text);
      }
    }
    const joined = lines.join('\n').trim();
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
}

/**
 * Extracts comprehensive textual/semantic representation from any tldraw or custom CanvasOS shape props
 */
export function extractShapeSemanticText(props: Record<string, any> | undefined): string | undefined {
  if (!props) return undefined;

  // 1. Rich card markdown content
  if (typeof props.content === 'string' && props.content.trim()) {
    return props.content.trim();
  }

  // 2. Direct string text property (cards, stickies)
  if (typeof props.text === 'string' && props.text.trim()) {
    return props.text.trim();
  }

  // 3. tldraw v3 richText AST (geo, text, note shapes)
  const rich = extractPlainTextFromRichText(props.richText);
  if (rich) return rich;

  // 4. Document shape sections
  if (Array.isArray(props.sections) && props.sections.length > 0) {
    const secTexts = props.sections
      .map((s: any) => `${s.title || ''}: ${s.content || ''}`.trim())
      .filter(Boolean);
    if (secTexts.length > 0) return secTexts.join('\n\n');
  }

  // 5. Slide deck slides
  if (Array.isArray(props.slides) && props.slides.length > 0) {
    const slideTexts = props.slides
      .map((s: any) => {
        const parts = [s?.title || '', s?.subtitle || '', ...(Array.isArray(s?.bullets) ? s.bullets : []), s?.content || ''].filter(Boolean);
        return parts.join(' - ');
      })
      .filter(Boolean);
    if (slideTexts.length > 0) return slideTexts.join('\n\n');
  }

  // 6. Code card or artifact code snippet
  if (typeof props.code === 'string' && props.code.trim()) {
    return props.code.trim();
  }

  return undefined;
}

/**
 * Converts a Blob to a base64 Data URL (e.g. "data:image/png;base64,...")
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to base64 Data URL'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Extracts raw base64 string and mimeType from a Data URL
 */
export function extractBase64(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: 'image/png', base64: dataUrl };
}

/**
 * Extracts rich grounded spatial context from tldraw editor
 */
export function getSpatialGroundedContext(editor: Editor | null): GroundedSpatialContext {
  if (!editor) {
    return {
      selectedCount: 0,
      selectedShapes: [],
      visibleCount: 0,
      zoom: 1,
      zoomFormatted: '1.0x',
      center: { x: 0, y: 0 },
      viewportBounds: { x: 0, y: 0, w: 0, h: 0 },
      totalShapesCount: 0,
    };
  }

  const selectedShapeList = editor.getSelectedShapes();
  const selectedShapes = selectedShapeList.map((shape) => {
    const props = (shape.props || {}) as Record<string, any>;
    const bounds = editor.getShapePageBounds(shape.id);
    const semanticText = extractShapeSemanticText(props);

    return {
      id: shape.id,
      type: shape.type,
      title: typeof props.title === 'string' ? props.title : undefined,
      text: semanticText,
      content: typeof props.content === 'string' ? props.content : undefined,
      code: typeof props.code === 'string' ? props.code : undefined,
      language: typeof props.language === 'string' ? props.language : undefined,
      archetype: typeof props.archetype === 'string' ? props.archetype : undefined,
      color: typeof props.color === 'string' ? props.color : undefined,
      bounds: bounds
        ? { x: Math.round(bounds.minX), y: Math.round(bounds.minY), w: Math.round(bounds.w), h: Math.round(bounds.h) }
        : undefined,
      from: typeof props.start === 'object' && props.start?.binding ? props.start.binding : undefined,
      to: typeof props.end === 'object' && props.end?.binding ? props.end.binding : undefined,
    };
  });

  const vpBounds = editor.getViewportPageBounds();
  const allPageIds = Array.from(editor.getCurrentPageShapeIds());

  let visibleCount = 0;
  for (const id of allPageIds) {
    const b = editor.getShapePageBounds(id);
    if (b && b.maxX >= vpBounds.minX && b.minX <= vpBounds.maxX && b.maxY >= vpBounds.minY && b.minY <= vpBounds.maxY) {
      visibleCount++;
    }
  }

  const zoom = editor.getZoomLevel();
  const screenCenter = editor.getViewportScreenCenter();
  const center = editor.screenToPage(screenCenter);

  return {
    selectedCount: selectedShapes.length,
    selectedShapes,
    visibleCount,
    zoom: Number(zoom.toFixed(2)),
    zoomFormatted: `${zoom.toFixed(1)}x`,
    center: { x: Math.round(center.x), y: Math.round(center.y) },
    viewportBounds: {
      x: Math.round(vpBounds.x),
      y: Math.round(vpBounds.y),
      w: Math.round(vpBounds.w),
      h: Math.round(vpBounds.h),
    },
    totalShapesCount: allPageIds.length,
  };
}

/**
 * Downscales and compresses an image Blob to JPEG with high quality (0.85) and bounded dimensions (<1400px).
 * Prevents massive JSON payloads (>10MB) from hitting Next.js Edge/API body size limits.
 */
export async function compressImageToJpeg(
  blob: Blob,
  maxDimension = 1400,
  quality = 0.85
): Promise<{ blob: Blob; mimeType: string; width: number; height: number }> {
  if (typeof window === 'undefined') {
    return { blob, mimeType: blob.type || 'image/png', width: 0, height: 0 };
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      // Proportional downscale if exceeding maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      width = Math.max(1, Math.round(width));
      height = Math.max(1, Math.round(height));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve({ blob, mimeType: blob.type || 'image/png', width, height });
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Solid canvas background (dark slate matching CanvasOS canvas theme)
      // prevents black background artifacts when transparent PNG is converted to JPEG
      ctx.fillStyle = '#0b0d18';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (compressedBlob) => {
          if (compressedBlob && compressedBlob.size > 0) {
            resolve({
              blob: compressedBlob,
              mimeType: 'image/jpeg',
              width,
              height,
            });
          } else {
            resolve({ blob, mimeType: blob.type || 'image/png', width, height });
          }
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ blob, mimeType: blob.type || 'image/png', width: 0, height: 0 });
    };

    img.src = url;
  });
}

/**
 * Fallback SVG-to-Canvas rasterizer if editor.toImage encounters canvas/browser quirks.
 * Uses a base64 Data URL rather than URL.createObjectURL to avoid Chrome canvas-tainting SecurityErrors on foreignObjects.
 */
async function fallbackSvgToImageBlob(
  svgString: string,
  width: number,
  height: number,
  maxDimension = 1400,
  quality = 0.85
): Promise<{ blob: Blob; mimeType: string; width: number; height: number }> {
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const dataUrl = await blobToDataUrl(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let targetW = Math.max(100, Math.round(width * 1.5));
        let targetH = Math.max(100, Math.round(height * 1.5));

        if (targetW > maxDimension || targetH > maxDimension) {
          if (targetW >= targetH) {
            targetH = Math.round((targetH * maxDimension) / targetW);
            targetW = maxDimension;
          } else {
            targetW = Math.round((targetW * maxDimension) / targetH);
            targetH = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D canvas context');
        ctx.fillStyle = '#0b0d18'; // Match canvas dark background
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve({ blob, mimeType: 'image/jpeg', width: targetW, height: targetH });
            } else {
              reject(new Error('Canvas toBlob returned null'));
            }
          },
          'image/jpeg',
          quality
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = (e) => {
      reject(new Error(`Failed to load SVG into Image: ${String(e)}`));
    };

    img.src = dataUrl;
  });
}

/**
 * Captures selected shapes or viewport area as a high-fidelity PNG image using tldraw v3 APIs
 */
export async function captureSelectionOrViewportAsImage(
  editor: Editor,
  options: {
    padding?: number;
    scale?: number;
    maxDimension?: number;
    quality?: number;
  } = {}
): Promise<CapturedVisionData> {
  const padding = options.padding ?? 32;
  const maxDimension = options.maxDimension ?? 1400;
  const quality = options.quality ?? 0.85;
  const selectedShapes = editor.getSelectedShapes();
  const hasSelection = selectedShapes.length > 0;

  let targetShapes: TLShape[] = selectedShapes;

  if (!hasSelection) {
    // If no shapes selected, gather shapes intersecting current viewport
    const vp = editor.getViewportPageBounds();
    const allIds = Array.from(editor.getCurrentPageShapeIds());
    const inVpShapes: TLShape[] = [];

    for (const id of allIds) {
      const b = editor.getShapePageBounds(id);
      if (b && b.maxX >= vp.minX && b.minX <= vp.maxX && b.maxY >= vp.minY && b.minY <= vp.maxY) {
        const shape = editor.getShape(id);
        if (shape) inVpShapes.push(shape);
      }
    }

    targetShapes = inVpShapes.length > 0 ? inVpShapes : allIds.map((id) => editor.getShape(id)).filter((s): s is TLShape => !!s);
  }

  if (targetShapes.length === 0) {
    throw new Error('Canvas is completely empty. Please draw or create shapes before capturing vision.');
  }

  // Calculate cumulative bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of targetShapes) {
    const b = editor.getShapePageBounds(s.id);
    if (b) {
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
  }

  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 400;
    maxY = 300;
  }

  const bounds = {
    minX,
    minY,
    maxX,
    maxY,
    w: Math.max(100, maxX - minX),
    h: Math.max(100, maxY - minY),
  };

  // Extract semantic shape summaries for multimodal grounding
  const shapeSummaries = targetShapes.map((s) => {
    const props = (s.props || {}) as Record<string, any>;
    const semanticText = extractShapeSemanticText(props);
    return {
      id: s.id,
      type: s.type,
      title: typeof props.title === 'string' ? props.title : undefined,
      text: semanticText,
      content: typeof props.content === 'string' ? props.content : undefined,
      code: typeof props.code === 'string' ? props.code : undefined,
      language: typeof props.language === 'string' ? props.language : undefined,
      color: typeof props.color === 'string' ? props.color : undefined,
      archetype: typeof props.archetype === 'string' ? props.archetype : undefined,
    };
  });

  // Calculate dynamic scale to ensure initial rasterization doesn't blow up memory
  const maxDim = Math.max(bounds.w, bounds.h);
  const targetScale = options.scale ?? Math.min(1.5, Math.max(0.5, maxDimension / Math.max(1, maxDim)));

  let blob: Blob;
  let mimeType = 'image/jpeg';
  let width = bounds.w;
  let height = bounds.h;
  let exportedSvg: string | undefined = undefined;

  try {
    // Primary: use tldraw v3 editor.toImage with format: 'jpeg' and quality
    let result: { blob: Blob; width: number; height: number };
    try {
      result = await editor.toImage(targetShapes, {
        format: 'jpeg',
        quality,
        background: true,
        padding,
        scale: targetScale,
      });
    } catch {
      // Fallback to png if the tldraw engine has an issue with jpeg export
      result = await editor.toImage(targetShapes, {
        format: 'png',
        background: true,
        padding,
        scale: targetScale,
      });
    }
    blob = result.blob;
    width = result.width;
    height = result.height;
    mimeType = result.blob.type || 'image/jpeg';

    // Also get SVG string if available for multimodal richness
    try {
      const svgRes = await editor.getSvgString(targetShapes, { padding, background: true });
      if (svgRes) exportedSvg = svgRes.svg;
    } catch {}
  } catch (toImageErr) {
    console.warn('[SpatialVision] editor.toImage failed, attempting SVG fallback:', toImageErr);
    // Secondary fallback: export to SVG string then canvas rasterize
    const svgResult = await editor.getSvgString(targetShapes, {
      padding,
      background: true,
    });
    if (!svgResult) {
      throw new Error('Failed to export selection to SVG or PNG image.');
    }
    exportedSvg = svgResult.svg;
    const raster = await fallbackSvgToImageBlob(svgResult.svg, svgResult.width, svgResult.height, maxDimension, quality);
    blob = raster.blob;
    mimeType = raster.mimeType;
    width = raster.width;
    height = raster.height;
  }

  // Safety downscale & compress if blob exceeds 600 KB or dimensions exceed maxDimension
  if (blob.size > 600 * 1024 || width > maxDimension || height > maxDimension || mimeType === 'image/png') {
    try {
      const compressed = await compressImageToJpeg(blob, maxDimension, quality);
      blob = compressed.blob;
      mimeType = compressed.mimeType;
      width = compressed.width;
      height = compressed.height;
    } catch (compErr) {
      console.warn('[SpatialVision] Secondary compression skipped:', compErr);
    }
  }

  const dataUrl = await blobToDataUrl(blob);
  const { base64 } = extractBase64(dataUrl);

  return {
    blob,
    dataUrl,
    base64,
    mimeType,
    width,
    height,
    svg: exportedSvg,
    bounds,
    shapeIds: targetShapes.map((s) => s.id),
    shapeSummaries,
    isSelection: hasSelection,
  };
}

/**
 * Calculates optimal Kiwi.js Cassowary placement coordinates for a newly generated live sandbox artifact
 */
export function calculateMakeRealPlacement(
  bounds: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number },
  anchorShapeId?: string,
  desiredW?: number,
  desiredH?: number,
  existingShapes?: Array<{ minX: number; minY: number; maxX: number; maxY: number }>
): { x: number; y: number; w: number; h: number; relative: string } {
  const artifactW = desiredW && desiredW > 0 ? Math.round(desiredW) : 780;
  const artifactH = desiredH && desiredH > 0 ? Math.round(desiredH) : 540;
  const margin = 48;

  // Use Kiwi.js (Cassowary linear arithmetic simplex constraint solver)
  const solver = new Solver();
  const targetX = new Variable('targetX');
  const targetY = new Variable('targetY');

  let relative = '';

  if (bounds.w > 900) {
    // For wide sketches (>900px), place directly beneath the sketch
    relative = anchorShapeId ? `below:${anchorShapeId}` : 'below:selection';

    // targetX == bounds.minX (align with left edge)
    solver.addConstraint(
      new Constraint(new Expression(targetX), Operator.Eq, new Expression(bounds.minX), Strength.strong)
    );
    // targetY == bounds.maxY + margin
    solver.addConstraint(
      new Constraint(new Expression(targetY), Operator.Eq, new Expression(bounds.maxY + margin), Strength.required)
    );
  } else {
    // Standard: place immediately to the right of the sketch
    relative = anchorShapeId ? `right_of:${anchorShapeId}` : 'right_of:selection';

    // targetX == bounds.maxX + margin
    solver.addConstraint(
      new Constraint(new Expression(targetX), Operator.Eq, new Expression(bounds.maxX + margin), Strength.required)
    );
    // targetY == bounds.minY (align with top edge)
    solver.addConstraint(
      new Constraint(new Expression(targetY), Operator.Eq, new Expression(bounds.minY), Strength.strong)
    );
  }

  solver.updateVariables();

  let resolvedX = Math.round(targetX.value());
  let resolvedY = Math.round(targetY.value());

  // Collision detection and Kiwi constraint resolution with existing shapes
  if (existingShapes && existingShapes.length > 0) {
    const hasCollision = (x: number, y: number, w: number, h: number) => {
      for (const s of existingShapes) {
        // Exclude shapes that are part of the sketch bounds itself
        if (
          s.minX >= bounds.minX - 2 &&
          s.maxX <= bounds.maxX + 2 &&
          s.minY >= bounds.minY - 2 &&
          s.maxY <= bounds.maxY + 2
        ) {
          continue;
        }
        const overlap = !(
          x + w <= s.minX ||
          x >= s.maxX ||
          y + h <= s.minY ||
          y >= s.maxY
        );
        if (overlap) return true;
      }
      return false;
    };

    if (hasCollision(resolvedX, resolvedY, artifactW, artifactH)) {
      // 1. Try placing directly below the sketch if right has collision
      const belowY = bounds.maxY + margin;
      const belowX = bounds.minX;
      if (!hasCollision(belowX, belowY, artifactW, artifactH)) {
        resolvedX = belowX;
        resolvedY = belowY;
        relative = anchorShapeId ? `below:${anchorShapeId}` : 'below:selection';
      } else {
        // 2. Cascade down or right to find collision-free spot by jumping past colliders
        let candidateY = resolvedY;
        let found = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          const colliders = existingShapes.filter(
            (s) =>
              !(
                resolvedX + artifactW <= s.minX ||
                resolvedX >= s.maxX ||
                candidateY + artifactH <= s.minY ||
                candidateY >= s.maxY
              )
          );
          if (colliders.length === 0) {
            resolvedY = candidateY;
            found = true;
            break;
          }
          const maxBottom = Math.max(...colliders.map((c) => c.maxY));
          candidateY = maxBottom + margin;
        }
        if (!found) {
          // Push further right past colliding cluster
          let candidateX = resolvedX;
          for (let attempt = 0; attempt < 8; attempt++) {
            const colliders = existingShapes.filter(
              (s) =>
                !(
                  candidateX + artifactW <= s.minX ||
                  candidateX >= s.maxX ||
                  resolvedY + artifactH <= s.minY ||
                  resolvedY >= s.maxY
                )
            );
            if (colliders.length === 0) {
              resolvedX = candidateX;
              break;
            }
            const maxRight = Math.max(...colliders.map((c) => c.maxX));
            candidateX = maxRight + margin;
          }
        }
      }
    }
  }

  return {
    x: resolvedX,
    y: resolvedY,
    w: artifactW,
    h: artifactH,
    relative,
  };
}
