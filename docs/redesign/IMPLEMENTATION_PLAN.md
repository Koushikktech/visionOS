# Implementation handoff and phase gates

Status: implementation performed on 28 October 2026 after the user requested continuation. See [IMPLEMENTATION_RECORD.md](IMPLEMENTATION_RECORD.md) for changes, evidence and remaining verification limits. The phase gates below remain the original handoff requirements.

## Ground rules

1. Read DESIGN_SPEC.md and inspect the current checkout. There is a large pre-existing dirty worktree. Do not reset, stash, overwrite or characterize it as your work.
2. Preserve current shape schemas, board recovery, user keys, write guards, exports, artifact isolation and input routing. UI refactoring must not weaken those behaviors.
3. Keep Next.js/React, Tailwind, existing CSS custom properties, Lucide and Framer Motion. Do not introduce a second styling system or a new motion framework. Avoid a WebGL or animation-library dependency for Studio.
4. Use one owner for navigation intents, onboarding, provider settings and modal stack. React remounts and browser history must not repeat samples or AI sends.
5. The written specification controls behavior. Visual boards use sample content, not live data. All new capabilities below are planned, not already implemented.
6. User preference: coding via Luna with xhigh reasoning, coordinator reviews and verifies. Assign disjoint files after defining shared contracts. Do not use agents to reinterpret product direction independently. Monitor the five-hour usage allowance and leave a clean handoff before less than 5% remains.
7. Swarm stays excluded. Do not implement public SaaS features, new workspace persistence, image generation, a plugin marketplace, or unrelated roadmap work.

## Phase 0 — baseline and contracts

Read applicable AGENTS.md. Record `git status --short`. Run existing typecheck and tests once to identify baseline failures; distinguish them from regressions. The inspected dashboard references `X` in its settings dialog but the inspected import list omitted it: verify this as a potential baseline build failure rather than silently assuming older audit success covers the current branch.

Trace actual provider adapters, supported model configuration, persisted-board shape and recovery APIs. Confirm every current tool and export has a destination in the redesigned chrome. Save a capability map before refactoring.

Agree on proposed boundaries (names are illustrative, behavior is required):

- `StudioScreen`: layout only; reads summary and issues navigation intents.
- `WorkspaceSummary`: checking / empty / ready / unavailable / error; real page IDs/names, optional safe preview, optional timestamp with explicit source. An unreadable summary never becomes empty.
- `WorkspaceLaunchIntent`: open existing page; create page; insert a bundled example on a new page; open composer draft; restore backup. Stable identity and consumed acknowledgement prevent replay. Do not put API keys or prompts in the URL.
- `ProviderSetup`: shared state and form used by Studio and canvas; persistence mode and validation status separate from provider selection.
- `DialogShell`: focus management, visible viewport sizing, escape/backdrop policy, accessible labels and modal layering.
- `FirstUseController`: one owner, dismissible tips, session fallback when storage is blocked.

Gate: contracts documented, baseline recorded, no engine rewrite hidden inside visual work.

## Phase 1 — foundation and visual proof

Likely files: `src/lib/tokens.ts`, `src/app/globals.css`, shared UI shell/components. Audit existing token consumers before changing exported meanings. Add semantic variables with safe migration aliases; convert one surface at a time. Keep user's canvas colors separate from application theme.

Build the new header, buttons, inputs, surface primitives, dialog shell and a faithful Studio layout with explicitly labeled fixture states used only in development or tests. Show populated and empty Studio at desktop/tablet/compact widths. Build the local authored Field Notes previews. No network fonts or unlicensed competitor assets.

Gate: dominant real-work preview, typography and material hierarchy match the design; light/dark and focus states exist; layout does not fall back to four generic gradient tiles. Remove development fixtures from production routes before integration is complete.

## Phase 2 — real Studio, metadata and navigation

Likely files: `VisionDashboard.tsx` (replace or rename), `src/app/page.tsx`, `Canvas.tsx`, a narrowly scoped summary adapter.

The current canvas uses tldraw's `persistenceKey="visionos-board-store"`; that does not mean a valid board JSON lives at a matching localStorage key. Do not scrape undocumented IndexedDB internals or infer emptiness from localStorage absence. Prefer an app-owned small summary recorded after successful editor hydration and real persistence events. Reuse validated recovery summaries where appropriate, labeling recovery provenance. Older users without summary metadata must be allowed to open their board normally.

Preview strategy: create an inert local representation from editor records after hydration. Bound processing to the active page, cap representative shapes (initial target 80), debounce noncritical preview work (initial target 800ms), and never block drawing or saving. Keep topology and bounds; simplify dense/unsupported content and fall back to titled silhouettes. Do not execute artifacts, load external embeds or fetch remote images for thumbnails. No keys, app runtime storage or hidden document content in metadata. Avoid large inline strings in localStorage; store bounded local preview data in an app-owned store, invalidate on restore/clear, and tolerate quota failures independently of canvas persistence.

A rendered snapshot is optional; a truthful vector overview is sufficient. Cross-origin app screenshots are not a requirement. Cache version and document revision prevent showing one page's preview under another page's name. If a capture cannot be trusted, use the neutral fallback.

Navigation: use current history conventions while eliminating first-frame dashboard flash on direct canvas navigation. Browser back/forward changes view/page without replay. `New page` uses the real tldraw page API and never deletes. Launch intents wait for editor readiness and recovery write eligibility. Create/draft operations must not fire from a fragile fixed timeout. Pending recovery prevents mutation but preserves intent for explicit retry.

Gate: loaded, empty, unknown, storage-blocked and stale-preview states work; old boards open; back/forward and double-tap do not duplicate operations.

## Phase 3 — onboarding and examples

Likely files: `VisionOnboardingModal.tsx`, `Canvas.tsx`, `src/app/page.tsx`, local example fixtures and first-use controller.

Replace four-step flow with the optional sample and contextual tips. Keep compatibility with prior onboarding dismissal; don't force old users through a new tour. Example actions add a distinct page to the current workspace. Consider a per-intent insertion receipt so double taps and React remounts cannot duplicate it. Do not overwrite a previously edited sample; 'Try again' explicitly creates another page.

Author three fixtures: sketch/timer/brief/deck; brief/slides; notes/connectors. Samples use existing shape schemas and inline assets. The timer must be functional with no network access, external dependencies or background activity while paused. Studio preview remains inert. Confirm placement and default camera are sensible on iPad. Use existing guarded mutation/history paths so insertion is undoable.

Gate: first-use without a key succeeds; sample has no network requests; tips dismiss/restart; populated workspace unchanged; editor-null actions no longer silently fail.

## Phase 4 — provider setup and AI interaction

Likely files: shared setup component, `VisionDashboard.tsx`, `VisionOnboardingModal.tsx`, `SpatialAIOmnibar.tsx`, settings integration in `useSpatialAI.ts` only as necessary.

Unify provider state; preserve OpenRouter access currently present in canvas but absent from dashboard/onboarding. Validate OpenAI adapter support before showing it; remove unsupported credit/session-token/OAuth claims from production UI. Reuse existing key persistence utilities and report actual save results. A failed verification or storage write must not display success. Requests in flight must not update a dismissed/replaced setup panel with stale status.

Studio prompts become drafts. No automatic API spend on example selection or navigation. After provider setup, the draft remains ready for an explicit Send. Show actual selection context; retain Stop, error correction, edit and supported undo. Keep current streamed-action and rollback semantics. Status words must map to actual event phases, not invented AI reasoning.

Gate: missing/invalid key, network failure, unsupported provider, storage fallback, dismissal and return preserve draft and context; no duplicate API request; existing key removal and failover semantics remain intact.

## Phase 5 — canvas chrome and content surfaces

Likely files: `AppleFloatingDock.tsx`, `ApplePagesPill.tsx`, `AppleViewportPill.tsx`, `ContextualFormattingPill.tsx`, `SpatialAIOmnibar.tsx`, `ShapeFocusLayer.tsx`, shape utilities.

Refactor chrome after the shared tokens and shell stabilize. Keep a checklist of existing actions and keyboard mappings. Coordinate dock, page controls and composer bounding boxes with the existing visible-viewport hooks. Touch popovers must never overlap the action needed to dismiss or commit them. Preserve pan, pinch, Pencil and card-scroll boundary logic.

Standardize native artifact headers and focus editors. Retain independent readable document/code/slide content styling. Application theme changes must not replace generated HTML styles or rewrite saved artifacts. Keep draft recovery, export format and presentation controls. Document metadata becomes secondary without deleting fields.

Gate: all existing actions still reachable; typing does not trigger canvas shortcuts; 320px and short landscape editors retain close/save access; iframe interaction does not trap panning.

## Phase 6 — permissions, recovery and motion

Likely files: `ArtifactNetworkPermissionsDialog.tsx`, `BoardRecoveryNotice.tsx`, `LaunchRecoveryScreen.tsx`, shell and transition orchestration.

Apply the design shell without changing origin validation, source binding, remembered grants, peer-connection restrictions, restore locks or confirmation defaults. Match the exact consequences in copy. Refactor visual grouping rather than removing important warning text.

Add the signature transition last. Use an inert preview layer; do not mount two live persisted editors or running app iframes for animation. Cleanup on navigation, resize, error and cancellation. Coordinate with editor readiness and existing fallback. Reduced motion, failed preview, heavy boards and short viewports must have a fast static path. Keep overlays from intercepting pointer input after transition.

Gate: permission and recovery regression checks pass; static fallbacks work; idle page has no animation loop; user input is never delayed for choreography.

## Verification matrix

| Area | Required checks | Evidence |
|---|---|---|
| Data safety | Existing board, multiple pages, new page, sample twice, restore, stale summary, blocked storage, cross-tab recovery conflict | Functional tests plus manual state notes |
| Providers | All supported providers, absent/invalid key, storage failure, validation failure, no auto-send, draft survives close | Integration tests with controlled requests; live provider checks only if authorized and keys available |
| Input | Mouse, trackpad, touch emulation, keyboard-only, IME, software keyboard | Browser interaction checklist; physical iPad/Pencil explicitly separate |
| Responsive | 1440×900, 1024×768, 768×1024, 600×800, 390×844, 320×568, 1024×500 | Screenshots of Studio, setup, canvas, editor and permission states |
| Accessibility | Light/dark, 200% text/zoom, narrow reflow, contrast, visible focus, modal focus restore, reduced motion/transparency, screen-reader labels | Measured contrast and observed keyboard/reader results; don't imply a full accessibility certification |
| Motion | Transition interrupted, resize midway, slow load, back during load, repeated entry, reduced motion | Playback inspection at 10% speed plus normal speed |
| Performance | Idle Studio, 80-shape representative preview, dense 500-shape page, active iframe excluded from previews | Main-thread/profile evidence; target no added >50ms preview task, no idle animation work |
| Existing behavior | AI actions/rollback, editable PPTX, backups, artifact grants/storage, recovery and input policy | Relevant existing automated tests; add tests only for meaningful new contracts |
| Build | `bun run typecheck`, `bun test`, `bun run build` using installed runtime | Exact commands and results, baseline failures distinguished |

Use Chromium and WebKit for browser verification. Emulated WebKit is not physical iPad Safari certification. Do not open personal Safari tabs or change the user's browser state merely to test. Test within an isolated local browser context when available. If tools or hardware are unavailable, state the gap in the final handoff.

Performance numbers above are targets, not measured claims. If the thumbnail morph causes frame drops, ship the polished crossfade rather than a broken signature effect. Never weaken persistence or sandboxing for visual fidelity.

## Coordination and completion record

Safe parallel split after Phase 0 contracts: (A) Studio and fixtures; (B) shared setup/onboarding; (C) tokens/dialog shell, followed by canvas chrome. Assign one owner to `Canvas.tsx`, `page.tsx` and global CSS integration. Shared-file edits must be serialized or explicitly coordinated. Review each agent's diff, verify behavior, then integrate. Agents cannot independently add features or change storage schemas.

At each completed phase append: files changed, implemented states, commands/results, screenshots, remaining limits, next phase. Do not mark a phase complete from screenshots alone. Finish with a product walkthrough and an explicit list of unverified hardware/provider checks. No estimated completion time is promised by this plan.

## Completion criteria for the redesign

- Studio is a truthful entrance to the actual local workspace, with a distinctive spatial preview and useful examples.
- First use is optional and experiential; AI setup is contextual and accurate.
- Canvas, editors, settings and safety surfaces share one coherent design system.
- Every working feature remains reachable; no new SaaS or Swarm scope appears.
- Functional, responsive, accessibility and motion gates have evidence.
- No test fixtures, fake metrics, false saved/credit claims, dead links or placeholder controls ship.
- The coordinator records remaining physical-device or live-service gaps honestly.
