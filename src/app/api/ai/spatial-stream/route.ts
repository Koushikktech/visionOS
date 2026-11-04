import { NextRequest } from 'next/server';
import type { AISpatialStreamRequest, SpatialActionFrame } from '@/types/spatial';
import {
  readBoundedJson,
  RequestBodyTooLargeError,
  RequestValidationError,
  validateSpatialStreamRequest,
} from '@/lib/ai/request';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const parsed = await readBoundedJson(req);
    validateSpatialStreamRequest(parsed);
    const body: AISpatialStreamRequest = parsed;
    const { intent, prompt, culledContext } = body;

    const encoder = new TextEncoder();
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const selectedIds = culledContext.selectedNodes.map((n) => n.id);
    let cancelled = false;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (frame: SpatialActionFrame) => {
          if (cancelled) return;
          controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n'));
        };

        if (intent === 'organize') {
          if (selectedIds.length > 1) {
            // Align in clean horizontal or grid flow
            send({
              t: 'patch',
              op: 'align',
              nodeIds: selectedIds,
              direction: selectedIds.length > 3 ? 'grid' : 'horizontal',
              margin: 36,
            });
            await delay(100);
            if (cancelled) return;

            // Repel collisions around first node
            send({
              t: 'patch',
              op: 'repel_colliding',
              anchor: selectedIds[0],
              margin: 48,
            });
            await delay(80);
            if (cancelled) return;

            // Create organizing frame
            send({
              t: 'patch',
              op: 'create_group',
              id: `grp_org_${Date.now()}`,
              title: 'Organized Group',
              nodeIds: selectedIds,
            });
          }
        } else if (intent === 'connect') {
          // Connect Flow between selected nodes
          if (selectedIds.length >= 2) {
            for (let i = 0; i < selectedIds.length - 1; i++) {
              if (cancelled) return;
              send({
                t: 'patch',
                op: 'connect',
                from: selectedIds[i],
                to: selectedIds[i + 1],
                label: `Flow ${i + 1} ➔ ${i + 2}`,
              });
              await delay(80);
            }
          }
        } else if (intent === 'simulate') {
          send({
            t: 'patch',
            op: 'spawn_artifact',
            id: `art_sim_${Date.now()}`,
            title: 'Interactive Waveform Simulation',
            code: `<canvas id="c"></canvas>
<script>
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  function r(){ c.width = window.innerWidth; c.height = window.innerHeight; }
  window.onresize = r; r();
  let step = 0;
  function draw() {
    ctx.fillStyle = "rgba(11, 14, 28, 0.2)";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2;
    for(let i=0; i<5; i++) {
      ctx.beginPath();
      ctx.strokeStyle = "hsl(" + ((step*15 + i*45)%360) + ", 80%, 65%)";
      for(let x=0; x<c.width; x+=5) {
        let y = c.height/2 + Math.sin(x*0.015 + step*0.05 + i)*40 + Math.cos(x*0.008 - step*0.03)*25;
        if(x===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    step += 0.5;
    requestAnimationFrame(draw);
  }
  draw();
</script>`,
            relative: 'next_to:selection',
          });
        }

        if (!cancelled) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status =
      err instanceof RequestBodyTooLargeError
        ? 413
        : errorMsg === 'Invalid JSON request.' || err instanceof RequestValidationError
          ? 400
          : 500;
    return new Response(JSON.stringify({ error: errorMsg }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
