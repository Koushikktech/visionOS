# Project: CanvasOS Apple-Grade Remake & Architecture Revamp

## Architecture
CanvasOS is an AI-native spatial canvas operating system built on Next.js 15, React 19, and the tldraw v3 canvas substrate, with a Kiwi.js Cassowary layout solver and multi-agent AI assistants.
This project executes a complete design remake and architectural revamp, replacing default tldraw UI chrome (`hideUi={true}`) with a custom, pixel-perfect Apple-grade floating HUD and canvas interface inspired by the macOS Sequoia Siri / Apple Intelligence glass aesthetic, in strict compliance with Apple Human Interface Guidelines and tactile design engineering principles.

```
┌────────────────────────────────────────────────────────────────────────┐
│  src/app/page.tsx -> src/components/Canvas.tsx (<Tldraw hideUi={true}>) │
├────────────────────────────────────────────────────────────────────────┤
│  HUD Layer (z-[300..400]):                                             │
│  ├── AppleFloatingDock (bottom-center island dock: tools & creators)   │
│  ├── AppleViewportPill (bottom-left zoom % tabular-nums & undo/redo)   │
│  ├── ContextualFormattingPill (in-situ hover over selection: styles)  │
│  └── SpatialAIOmnibar (macOS Sequoia Siri liquid-glass panel)          │
├────────────────────────────────────────────────────────────────────────┤
│  Canvas Shapes Layer (7 custom shapes in src/shapes/):                 │
│  ├── RichCardShapeUtil, CodeCardShapeUtil, DocShapeUtil                │
│  ├── SlideDeckShapeUtil, ArtifactShapeUtil, MediaEmbedShapeUtil        │
│  └── VectorShapeUtil (de-cyberpunked, quiet obsidian glass)            │
├────────────────────────────────────────────────────────────────────────┤
│  Design Tokens & Substrate:                                            │
│  ├── globals.css & tailwind.config.js (obsidian glass, concentric math)│
│  └── framer-motion tactile physics springs (duration 0.3, bounce 0)   │
└────────────────────────────────────────────────────────────────────────┘
```

## Feature Inventory
Every requirement and feature discovered during survey is enumerated below with assigned milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Hide Default UI Chrome | Add `hideUi={true}` to `<Tldraw>` in `Canvas.tsx` to eliminate 100% of default tldraw chrome | M2 | ORIGINAL_REQUEST R1 |
| 2 | Floating Island Dock | Bottom-centered dock with select, hand/pan, draw, text, note, card spawner, geo shapes, arrow, eraser, clear | M2 | ORIGINAL_REQUEST R1 |
| 3 | Viewport & Zoom Pill | Floating indicator with tabular zoom percentage (`tabular-nums`), zoom in/out, fit to content, undo/redo | M2 | ORIGINAL_REQUEST R1 |
| 4 | Contextual Formatting Pill | Selection-attached pill with color swatches (`DefaultColorStyle`), stroke weights, alignments, Make Real, delete | M2 | ORIGINAL_REQUEST R1 |
| 5 | Obsidian Liquid Glass System | `backdrop-blur-3xl`, dark glass `rgba(18, 18, 24, 0.78)` to `rgba(24, 24, 32, 0.85)`, 1px specular highlight `border-white/10` | M1 | ORIGINAL_REQUEST R2 |
| 6 | Concentric Border Radii Rule | Enforce `outer radius = inner radius + padding` across all containers, cards, modals, and pills | M1, M3, M4 | ORIGINAL_REQUEST R3 |
| 7 | Tabular Numbers Typography | Apply `font-variant-numeric: tabular-nums` to all updating statistics, zoom %, slide numbers, latency badges | M1, M3, M4 | ORIGINAL_REQUEST R3 |
| 8 | Eliminate Cyberpunk Motifs | Strip neon glowing shadows, pulsing scanlines, and redundant telemetry across all components & shapes | M3 | ORIGINAL_REQUEST R2 |
| 9 | macOS Sequoia Siri AI Omnibar | Redesign Spatial AI chat & omnibar into unified obsidian glass floating panel with circular controls & pill input | M3 | ORIGINAL_REQUEST R2 |
| 10 | Tactile Touch Targets $\ge 40\times 40\text{px}$ | All interactive buttons, dock items, and pills must meet $\ge 40\times 40\text{px}$ hit area with `scale(0.96)` active state | M4 | ORIGINAL_REQUEST R4 |
| 11 | Icon Stroke Weight Matching | 1.5px stroke beside regular 400 text, 2px beside semibold 600 text | M4 | ORIGINAL_REQUEST R4 |
| 12 | Motion Restraint & Fluid Springs | `framer-motion` springs (`type: "spring", duration: 0.3, bounce: 0`) and `cubic-bezier(0.2, 0, 0, 1)` | M4 | ORIGINAL_REQUEST R4 |
| 13 | E2E & Component Test Suite | Add comprehensive test suites for design tokens, HUD interaction, shape concentricity, and baseline verification | M_TEST | ORIGINAL_REQUEST Quality |
| 14 | Libraries.dev Thinking Orbs | Integrate `thinking-orbs` (`<ThinkingOrb size={20|64} state="breathing"|"solving"|"shaping" theme="dark" />`) into AI reasoning, streaming responses, and Make Real synthesis | M3 | USER_ADDITION Libraries.dev |
| 15 | Libraries.dev Border Beam | Integrate `border-beam` (`<BorderBeam active={...} size="line"|"pulse-inner" />`) on AI prompt input while streaming and Make Real CTA | M3 | USER_ADDITION Libraries.dev |
| 16 | Libraries.dev Voice Glow | Integrate `voice-glow` (`<VoiceBeam />`) reactive sound glow onto the microphone dictation input in the Siri AI Omnibar | M3 | USER_ADDITION Libraries.dev |

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Design System & Tokens | Obsidian glass tokens, concentric radii utilities, typography, tabular numbers, elevation shadows in `globals.css` and `tailwind.config.js` | None | DONE |
| M2 | Custom HUD & Floating Dock | Build `AppleFloatingDock`, `AppleViewportPill`, `ContextualFormattingPill`, set `hideUi={true}` in `Canvas.tsx` | M1 | DONE |
| M3 | Canvas Shapes, Surfaces & Omnibar | Revamp 7 custom shapes with concentric radii & tabular-nums, strip cyberpunk neon glows, build macOS Sequoia Siri AI Omnibar | M1, M2 | DONE |
| M4 | Tactile Polish & HIG Hardening | Touch targets $\ge 40\times 40\text{px}$, `scale(0.96)` active states, icon stroke matching (1.5px/2px), spring motion | M2, M3 | DONE |
| M5 | Adversarial Verification & Gate | Challenger stress testing, Forensic Integrity Audit, TypeScript check (`tsc --noEmit`), full test suite (`bun test`), Next.js build | M4, M_TEST | DONE |
| M_TEST| E2E & Component Testing Track | Test infra, design token tests, HUD tests, concentricity tests, route tests (Tiers 1-4) publishing `TEST_READY.md` | None (Parallel) | DONE |

## Interface Contracts

### `AppleFloatingDock` ↔ `tldraw Editor`
- Input: `editor: Editor | null`
- Tool Selection:
  - Select: `editor.setCurrentTool('select')`
  - Pan: `editor.setCurrentTool('hand')`
  - Draw: `editor.setCurrentTool('draw')`
  - Text: `editor.setCurrentTool('text')`
  - Note: `editor.setCurrentTool('note')`
  - Geo: `editor.setCurrentTool('geo')`
  - Arrow: `editor.setCurrentTool('arrow')`
  - Eraser: `editor.setCurrentTool('eraser')`
  - Custom Shape Spawner: Spawns `rich_card`, `code_card`, `document`, `slide_deck`, or `artifact` at `editor.getViewportPageBounds().center`.
  - Clear: Deletes selected shapes or prompts to clear canvas.
- Active Tool Subscription: Subscribes to `editor.store.listen()` and tracks `editor.getCurrentToolId()`.

### `AppleViewportPill` ↔ `tldraw Editor`
- Input: `editor: Editor | null`
- Zoom State: Reads `editor.getZoomLevel()` dynamically formatted as `${Math.round(zoom * 100)}%` with `tabular-nums`.
- Actions:
  - Zoom In: `editor.zoomIn()`
  - Zoom Out: `editor.zoomOut()`
  - Zoom To Fit: `editor.zoomToFit({ animation: { duration: 250 } })`
  - Undo: `editor.undo()`, disabled when `!editor.getCanUndo()`
  - Redo: `editor.redo()`, disabled when `!editor.getCanRedo()`

### `ContextualFormattingPill` ↔ `tldraw Editor` & Selection
- Bounds: Computes screen coordinates from `editor.pageToScreen(bounds.topCenter)` hovering ~12px above selection.
- Actions:
  - Color Swatches: `editor.setStyleForSelectedShapes(DefaultColorStyle, color)`
  - Stroke Weight: `editor.setStyleForSelectedShapes(DefaultSizeStyle, size)`
  - Alignment: `editor.setStyleForSelectedShapes(DefaultTextAlignStyle, align)`
  - Make Real: Triggers `ai.makeReal()`
  - Delete: `editor.deleteShapes(editor.getSelectedShapeIds())`

### `SpatialAIOmnibar` ↔ `useSpatialAI`
- State: Model selection, chat history, prompt submission, audio/vision capture.
- Visual: Deep obsidian translucent glass `backdrop-blur-3xl`, 1px specular highlight `border-white/10`, circular top controls (dismiss, expand), bottom floating pill input bar with `+` menu and circular action button.
- Libraries.dev Effects:
  - `<ThinkingOrb size={20} state="breathing" | "solving" | "composing" theme="dark" />` beside assistant response/reasoning header while generating.
  - `<BorderBeam active={isStreaming} size="line" />` along the bottom edge of the input pill while generating.
  - `<VoiceBeam />` audio-reactive glow when dictation / microphone mode is active.

### `SpeculativeSkeletonOverlay` ↔ `spatial.skeletons` & Make Real
- During Make Real synthesis (<150ms TTFT speculative wireframe):
  - Embed `<ThinkingOrb size={64} state="shaping" theme="dark" />` centered inside the skeleton placeholder with tactile glass shimmer.
  - Wrap skeleton container with `<BorderBeam active={true} size="md" />` while synthesis is active.

## Code Layout
- `src/components/AppleFloatingDock.tsx`: Floating Island Dock component
- `src/components/AppleViewportPill.tsx`: Floating Viewport & Zoom Pill component
- `src/components/ContextualFormattingPill.tsx`: Selection-attached contextual styling pill
- `src/components/SpatialAIOmnibar.tsx`: macOS Sequoia Siri liquid-glass AI omnibar & assistant
- `src/components/Canvas.tsx`: Core canvas container mounting custom HUD and setting `hideUi={true}`
- `src/shapes/*.tsx`: 7 custom shapes audited for concentric radii, tabular numbers, and obsidian glass
- `src/app/globals.css`: Obsidian dark glass styles, typography, tabular numbers, concentric utilities
- `src/test/`: Test suites for tokens, HUD, concentricity, routes, empirical stress, and geometry sizing
