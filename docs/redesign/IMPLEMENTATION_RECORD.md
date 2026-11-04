# Redesign implementation record — 28 October 2026

## Phase 0: baseline and shared contracts

The existing dirty worktree was inspected and is preserved. Initial status is captured in `/tmp/visionos-redesign-baseline-status.txt`. Baseline typecheck/tests are running; outcomes follow below.

Integration boundaries:
- `workspaceStudio.ts` owns a versioned, bounded, app-owned inert metadata cache and launch intent types. Metadata is an overview captured after editor hydration, never evidence of a successful persistent save. Missing/invalid metadata is unavailable, never empty. No undocumented tldraw storage reads.
- `WorkspaceLaunchIntent`: `{ id, kind: 'open'|'new-page'|'example'|'draft'|'restore', pageId?, example?: 'field-notes'|'brief-slides'|'connections', draft? }`. The page owns pending intent and consumption acknowledgement. URL stores only view/page; replaying history cannot recreate operations.
- `VisionDashboard`: `onOpenCanvas(options?: {prompt?: string; template?: string; intent?: WorkspaceLaunchIntent})`, `onOpenTour` retained for compatibility; renders real summary or explicitly labeled sample/unknown states.
- `ProviderSetup`: shared standalone `isOpen`, `onClose`, `onSaved?` dialog, uses existing key storage and supported request adapters; saved is distinct from verified. Canvas refreshes its provider state after save.
- `DialogShell`: visible viewport bounds, existing focus trap, close/escape and focus return, solid semantic surfaces.
- Canvas remains the only owner of editor mutation and optional first-use hint. Recovery `canMutate`/write guards gate launch mutation. No automatic AI sends.

Capability destinations: existing dock tools/insertion, pages, viewport, formatting, focus editors, exports, backup/restore and recovery remain mounted; AI composer retains selection, stop, errors, key removal/failover. Provider adapters Gemini/OpenRouter/OpenAI exist in current source. Swarm and cloud/account work remain excluded.

## Baseline results

- Initial `bun test`: **458 passed, 0 failed**. Initial `bun run typecheck`: failed in old audit `.ts` scripts, an OpenAI error-label union, and a source-inspection test using an undeclared Bun global. Exact baseline output and status are in `evidence/`.
- Historical audit scripts are now excluded from the application TypeScript project; production source remains checked. The OpenAI error-label union now includes OpenAI. The obsolete dashboard class assertions were replaced with the new launch/draft safety contract.
- The available requested coding model was `gpt-6-luna`, with `xhigh` reasoning. Coding agents used disjoint ownership; integration and browser review were performed by the coordinator. Allowance was monitored throughout; no commit, deployment or publication was performed.

## Implemented phases and capability destinations

| Phase | Implementation | Evidence / boundary |
| --- | --- | --- |
| 0 — contracts | Baseline, supported providers, persistence/recovery paths, preserved dirty worktree, shared intent and summary contract | Baseline files above; no storage or engine replacement |
| 1 — visual foundation | Graphite/light semantic palette, system appearance plus explicit preference, solid reading/dialog surfaces, restrained floating glass, authored Field Notes composition, accessible setup shell | New `studio.css`, `provider-dialog.css`, semantic variables in `globals.css`; source and browser review |
| 2 — truthful Studio | Cached inert page overview from hydrated editor records, real page names/selection, unknown/blocked/empty distinctions, no fabricated saves or recents, draft launch, new page and guarded restore intent | Cache is bounded to 80 representative shapes and 80 KB. Preview labels identify capture, not persistence acknowledgement. Local metadata failure never blocks board saving |
| 3 — optional first use and examples | Removed forced four-step tour; optional dismissible canvas hint with session fallback. Three separate editable example pages. Field Notes includes timer wireframe, local focus timer, brief and three slides | Intent-derived page identity prevents replay; read-only/page limits checked; one undo boundary and safe rollback. Browser tests verify sample undo/redo |
| 4 — provider and AI | Shared Gemini/OpenRouter/OpenAI setup, masked key field, model details, actual browser/session/page-memory storage status, removal, no credit/OAuth claims. No-key Send opens setup without losing text; Save never sends; original prompts can be edited from the transcript | Dummy provider responses only. No live API key validation or funded-account claim. Existing routing/failover and streamed-action handling retained |
| 5 — canvas and editors | Existing tools/pages/viewport/history/exports retained. Two-row compact tool dock, one Ask AI launcher, neutral contextual chrome, readable focused editors, compact document section selector, secondary document metadata | Focus/permissions/backup guards retained. Shared native headers consolidate secondary actions while preserving their handlers |
| 6 — safety and continuity | Permission and recovery surfaces share semantic materials, readable status and viewport bounds. Topmost dialog owns keyboard trapping. One hydrated editor survives Studio navigation; canvas input is suspended and app frames are unmounted while Studio is visible | Immediate Back/Forward no longer races editor teardown. There is never a second live editor. Source/permissions are not rewritten by appearance changes |

### Integration decisions

The first real history test exposed a native persistence race when the editor was unmounted immediately after creating a page. The final implementation keeps one hydrated editor for the page lifetime, blurs its input while in Studio, suspends canvas input listeners and portal surfaces, and uses transient context to pause/unmount app runtimes. Returning restores public viewport geometry before executing an intent. This preserves native persistence behavior and avoids copying editor data into a replacement persistence engine.

The Studio overview uses inert, proportional vector silhouettes of real page bounds and safe visible titles. It neither executes app code nor includes hidden document bodies, app storage, credentials, remote media, or source code. Unknown metadata is never treated as proof of an empty board. Successful restore invalidates the optional overview cache.

The accurate static transition fallback ships: simplified vector silhouettes are not treated as a rendered screenshot suitable for a geometry morph. No synthetic matching animation or timer delays interactive readiness. No idle decorative animation is added.

### Existing capabilities preserved

- Drawing, selection, pan, text, sticky notes, shapes, arrows, eraser and insertion tools.
- Page creation, renaming, switching, deletion; viewport zoom, fit, undo and redo.
- AI selection/current-view context, voice controls, explicit Send, Stop, error messages, prompt reuse, streamed operations and rollback.
- Native document, code, note, app, slide and media surfaces; focused editing, draft recovery, document/code exports and editable PPTX.
- Workspace backup/restore, recovery review, cross-tab conflict handling, write guards, per-source website/peer grants, app isolation and app-storage acknowledgements.

## Browser verification

All contexts are isolated local Playwright contexts. The user's browser tabs, keys and workspace were not used. Scripts and screenshots live in `evidence/`.

- `studio-browser.cjs`: Chromium and WebKit, real sample insertion, populated Studio, draft open with zero AI sends, new page, immediate Back/Forward without replay, setup dismissal and bounds at 1440×900, 1024×768, 768×1024, 600×800, 390×844, 320×568 and 1024×500, light/dark screenshots. No page exceptions.
- `studio-safety-browser.cjs`: both engines, verified-empty Studio, sample undo/redo, no-key setup, saved key does not send, one explicitly sent dummy-provider error, 320px and short-landscape focused editor, appearance leaves app source unchanged, Studio suspends live app frames, and blocked browser storage with session hint dismissal. The timer uses the nested sandbox runner; pointer checks bypass Playwright's nested-frame stability polling after confirming a visible/enabled control.
- `studio-deep-browser.cjs`: both engines, 500-shape page with an 80-shape overview, zero running animations on idle Studio, 200% root text at 390px without horizontal Studio overflow, modal Tab containment, and 320px website-access dialog with remember/grant defaults unchanged.
- `solid-color-contrast.json`: computed solid palette contrast. Dark/light primary text 16.63:1 / 14.45:1, secondary on raised surface 7.38:1 / 5.64:1; input boundaries 3.95:1 / 3.84:1. This is not a certification of every composited surface.

### Remaining verification limits

- Physical iPad, Pencil, real software-keyboard behavior, IME hardware and screen-reader announcements were not certified by these browser checks.
- Live provider accounts, model availability and provider-specific billing were not tested. Saving a key explicitly does not verify it.
- The bundled timer has no external dependencies. The existing tldraw SDK still requests its fonts/icons/translations from its CDN when the editor starts; there is no claim of guaranteed offline first loading.
- The 80-shape cap and 500-shape functional check are verified. No main-thread performance SLA, physical-device frame rate, or full accessibility certification is claimed.
- No geometry-morph animation ships. The immediate static fallback preserves continuity through the same hydrated editor. A richer transition should be added only with a faithful rendered preview and measured performance.

### Final regression found during verification

A selected, interacted-with app followed by Undo exposed React's maximum update-depth error in the contextual toolbar. Its layout effect depended on its own positioned state while measuring a Framer-transformed rectangle. The implementation now measures untransformed layout width/height and responds to selection, viewport and real size changes rather than its own position. The final browser regression script uses the actual canvas Undo/Redo controls, then exercises the timer, AI setup, focused editor and artifact overflow menu. This finding was corrected before the final build; final results follow below.

## Final status and clean continuation boundary

Stopped further implementation/verification at the requested allowance guard: the final allowance response reported **4% remaining**. No commit, deployment or publication was performed. Product code is saved; the local production preview is available at http://127.0.0.1:3010 while the temporary server remains running.

Final commands:
- `bun run build`: passed, including application type validation (`evidence/build.txt`).
- `bun run typecheck`: passed.
- `bun test`: **470 passed, 0 failed**, 51 files (`evidence/tests.txt`).
- `git diff --check`: passed.
- Final `studio-browser.cjs` and `studio-deep-browser.cjs`: passed in Chromium and WebKit; current JSON results and screenshots are in `evidence/`.

**Expanded safety script is not fully green.** After the toolbar-loop fix, its final Chromium run passed timer Start/Pause/Reset, actual canvas Undo/Redo, no-key/provider-save/no-auto-send, controlled provider rejection, and compact document editing. It then timed out because the document export-menu trigger was outside the canvas camera viewport after resizing. No maximum-update-depth error recurred. The older `safety-browser-results.json` records the earlier successful two-engine suite before the timer/menu extension; it must not be treated as proof that the final expanded suite passed.

Next required verification: reframe/zoom the document into view after returning from its focused editor, then rerun the expanded safety script in both engines to verify overflow-menu keyboard navigation and finish the remaining post-menu checks on the final header implementation. Inspect modal stacking with recovery plus the first-use hint, and normal-motion interruption paths. Physical iPad/Pencil/software-keyboard, full screen-reader verification, live providers and measured performance remain separate checks. Phase 5/6 runtime verification is therefore incomplete; the implementation must not be described as fully accepted against every design gate.
