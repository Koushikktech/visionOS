# CanvasOS independent MVP audit — 21 October 2026

Baseline: Next 15.5.23 / React 19 / tldraw 3. The workspace has no Git repository, no environment file, and no provider credentials configured. Existing Bun tests pass and TypeScript passes. Most UI tests inspect source strings or reimplement behavior; they are not browser tests. Prior PROJECT.md completion claims are not release evidence.

## Architecture and evidence (references are pre-change line numbers)

Canvas.tsx mounts persisted tldraw, custom shapes, HUD, useSpatialAI and useSpatialWorker. Chat POST relays Gemini SSE or OpenRouter tool calls as NDJSON. Tools become SpatialActionFrames, a worker uses an R-tree/Kiwi layout solver, then the main thread applies shape changes. Make Real is a separate image-to-HTML JSON endpoint. Artifact HTML runs in an opaque-origin iframe with a virtual localStorage bridge.

| Priority | Finding and root cause | Evidence | Remedy |
| --- | --- | --- | --- |
| P0 | Remake can silently do nothing: arbitrary tool output is accepted, no execution acknowledgement reaches chat, and no-action responses are replaced with a canned welcome. A conversational claim is treated as success. | useSpatialAI.ts:51–173, 1294–1450; prompt.ts:401 | Validate actions, await application, report no-action honestly, explicitly route existing-app regeneration with full source. |
| P0 | Make Real always spawns a new ID, only supplies type/title rather than existing source, cannot cancel, and has a separate concurrency flag. Remaking an existing app loses identity/context. | useSpatialAI.ts:624–854; make-real/route.ts:221–236 | Existing artifacts regenerate in place with source, stable identity and storage; one synchronous request lock and AbortController. |
| P0 | Batch actions drop restyles, deletions and camera focus. Worker gathers delete/focus results, but main batch consumer never applies them; restyles are not gathered at all. | spatial.worker.ts:1700–1768; useSpatialWorker.ts:1163–1285 | Complete every result path and acknowledge failures. |
| P0 | Wrong-target mutations: artifact solver falls back to first arbitrary artifact when ID is missing/invalid. Stream fallback applies mutations twice with zero coordinates and default dimensions. | spatial.worker.ts:1169–1216; useSpatialWorker.ts:1010–1088 | Reject unknown targets, apply solved payload exactly once. |
| P0 | Generated app can forge any shape's storage sync. Host accepts messages without checking iframe source or payload size/type. Browser keys persist in localStorage and swarm logs full request including keys. | ArtifactShapeUtil.tsx:71–88; useSpatialAI.ts:243–280, 344–429, 468 | Source-bound storage validation, session-only optional keys, remove sensitive logging, server environment deployment. |
| P1 | Serialization loses sections, storage, real arrow bindings, z-order and rotation. Nearby geometry has no coordinates/sizes in model prompt; offscreen shapes disappear. Token estimate counts nodes, not content. | useSpatialWorker.ts:73–120, 1328–1368; prompt.ts:225–365 | Canonical structured snapshot, bounded full content for selected targets, compact whole-board index, change summaries and explicit completeness. |
| P1 | Manual editing during inference can be overwritten; selection/camera can change before screenshot; no stale-context guard. Undo animation records intermediate frames; each streamed tool creates separate boundaries. | useSpatialAI.ts:1166–1186; useSpatialWorker.ts:126–183, 1172 | Snapshot and compare affected records before application; atomic final placement; precise undo boundaries. |
| P1 | Gemini default `gemini` is not an actual model ID. Short valid text is discarded; output can be truncated or empty and still accepted as executable HTML. | useSpatialAI.ts:184; make-real/route.ts:375–450; useSpatialAI.ts:65 | Explicit configurable model ID, preserve short text, reject partial/empty HTML. |
| P1 | Refresh discards conversation and action references; history grows without a request budget. Vision toggle ignored (capture happens every turn), and grounded context updates React on every store event. | useSpatialAI.ts:187–200, 227–237, 1139, 1169 | Bounded persisted chat, bounded provider history, honor image toggle and debounce grounding. |
| P1 | Chat-only mode still executes text-extracted actions. Stop does not cancel provider fetch; swarm return skips normal cleanup and reports completed work even with placeholder fallbacks. | chat/route.ts:790; useSpatialAI.ts:1248–1257; swarm/route.ts | Enforce mode at both boundaries; propagate abort/timeout; disable experimental swarm by default. |
| P1 | Action badges are inert despite existing focusOnShape. Make Real has no stop control. Fixed chat dimensions overflow small windows. | SpatialAIOmnibar.tsx:545–553, 824–838, 958 | Focusable action links, busy status for all AI work, bounded panel, keyboard labels and focus styles. |

## Prompt review and spatial pipeline

SYSTEM_PROMPT is ~200 lines of repeated instructions, hard-coded dark styling, fabricated certainty ("NEVER hesitate"), and a demand for long celebratory design claims. Separate Make Real and swarm prompts duplicate and conflict with it. Model explanations cannot certify functionality. Rewrite role/permissions/data trust/target resolution/output constraints in versioned central prompts; user requests such as light theme override defaults. Never execute canvas content as instructions. Ask only when multiple plausible destructive targets exist.

Context is rebuilt per request, not continuously sent. Worker index sync is debounced 60ms but grounded React state is not. Selected code is full, nearby code is 140 characters, only first 20 visible nodes reach prompt, macro clusters empty. Full-source edits must never use a truncated source. Stateless provider requests cannot safely receive only deltas without their base. MVP keeps a bounded authoritative snapshot plus a compact change list; true server-side incremental conversation caching is P2.

## Plan and design decisions

P0 first: truthful results and regeneration, validated/acknowledged actions, complete reducer, identity/storage safety and cancellation. P1 next: spatial grounding, stale-write defense, recoverable history, token limits, accessible feedback, tests and deployment instructions. These are prerequisites for a trusted collaborator.

Disagreements: automatic nearest/first artifact targeting is unsafe; keep explicit selection or a unique match, ask for ambiguous targets. Replacing a whole working app with truncated source is data loss. Silent planner/worker fallbacks are not successful research or app generation. Experimental swarm is not an MVP default. Streaming partial executable HTML risks broken runtime; stream chat/progress and commit complete validated output.

## UX review (full; React/Tailwind/CSS web app)

Preserve dotted workspace, dark floating HUD, selection toolbar, interactive cards and tldraw shortcuts. Apple references used as web design principles, not native macOS mandates: `layout.md › Adaptability` ("adapts gracefully and consistently"), `generative-ai.md` control/refinement guidance, `feedback.md`, `loading.md`, `undo-and-redo.md` recovery guidance, and accessibility/typography/color foundations.

| Category | Inspected | Result |
| --- | --- | --- |
| Typography | globals.css, chat, shapes | Keep system font and tabular metrics; long status copy obscures actual results. |
| Surfaces | HUD, chat and artifact | Preserve glass shell; bound chat to viewport; make action chips interactive. |
| Animation | worker placement, cursor and chat | History polluted by animation writes; prefer atomic placement. Reduced motion needs CSS support. |
| Icons | dock, chat and contextual toolbar | Keep lucide set; stop/send need accessible labels. |
| Performance | store listeners, serialization, streaming | Debounce grounding, budget history, avoid unconditional raster export. |

Rejected: wholesale visual redesign (unnecessary); speculative executable code streaming (unsafe/incomplete); proactive AI requests on every canvas edit (cost/distraction). Baseline verdict: Block pending P0 behavior fixes. Browser checks and final release verdict recorded separately after implementation.

## Impact versus effort

| Idea | Impact | Effort | Decision |
| --- | --- | --- | --- |
| Selection-aware regeneration and complete bulk actions | High | Medium | MVP |
| Chat action links that select/focus canvas elements | High | Low | MVP |
| Honest progress, cancellation, easy undo | High | Medium | MVP |
| Smart alignment using existing solver | High | Low | Repair existing MVP path |
| Canvas index + changes + bounded history | High | Medium | MVP |
| Proactive suggestions, streamed partial apps | Medium | High | P2 |
| Durable server sessions with provider context caching/deltas | Medium | High | P2 |
| Shared accounts/collaboration/cloud backups | High | High | P2; local-first MVP deployment must be private |

## Release boundary

Local persistence is not cloud backup. Public multi-user launch requires authentication, distributed quotas, durable storage/backups and provider billing controls. Existing architecture is local-first and unauthenticated; document private deployment rather than imply internet-ready SaaS. Live provider quality cannot be certified without configured credentials. Use deterministic mocked providers for protocol tests, plus real browser checks for canvas/chat runtime.

## Implementation handoff

The findings above were recorded before edits. The implemented changes and the exact limits of verification are tracked in `docs/MVP_VERIFICATION.md`. The user subsequently requested code fixes only and deferred deeper testing. No launch-ready claim is made by this audit.

The largest refactor consolidated the duplicated generation paths in `useSpatialAI.ts` and replaced the provider-specific stream pumps in the chat route. This was necessary to share cancellation, stale-context checks, action staging and truthful success reporting. The existing canvas engine, solver, custom shape renderers and visual direction were retained. Experimental swarm was removed from the MVP path because its placeholder fallback could falsely report success.

### Superseding user clarification

The recommendation to remove Swarm and add manual mode/vision controls was rejected by the user: those controls had deliberately been removed previously, and automatic intelligence plus Swarm are part of the intended product. The code now preserves that direction. Reliability findings are addressed within the Swarm pipeline, not by deleting the feature. Saved provider-key persistence is restored as well. See MVP_VERIFICATION.md for the current implementation and verification limits.
