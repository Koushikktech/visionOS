# PROJECT CONTEXT & ARCHITECTURAL BLUEPRINT: visionOS

> **INSTRUCTION FOR THE CODING AGENT / HARNESS:**
> You are building **visionOS**, an AI-first spatial operating system for thinking. Read this document thoroughly before generating or modifying any code. It contains the complete product vision, architectural invariants, protocol schemas, threading models, and implementation guidelines.

---

## 1. The visionOS Architectural Thesis

Traditional canvas tools treat AI as a conversational sidebar that outputs static text into isolated chat bubbles. **visionOS** replaces this with an AI-first spatial operating system where the model acts as a physical collaborator on an infinite board.

The system operates across two interconnected layers:

1. **The Autonomous Agent Harness (The Brain):** A hierarchical Directed Acyclic Graph (DAG) orchestrator that evaluates intent, spawns visual skeleton containers speculatively in under 150ms, and dispatches parallel specialist workers.
2. **tldraw Reactive Substrate (The Body):** A hardware-accelerated, signal-driven spatial engine that translates streaming topological intents into smooth, collision-free 60 FPS spring animations, interactive sandboxes, and vector diagrams.

---

## 2. End-to-End System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    AUTONOMOUS AGENT HARNESS                                      │
│                                                                                                  │
│   1. Context Culling: 2D R-Tree (rbush) extracts selected nodes + 1.3x viewport (<300 tokens)    │
│   2. Macro-Planner (Gemini Flash): Generates Execution DAG + Speculative Skeletons (<150ms)      │
│   3. Worker Swarm (Parallel Streams): Markdown, Sandbox Code, Media Embeds, Vector Paths         │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ (Streaming NDJSON over Worker WebSocket / HTTP)
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               WEB WORKER 1: SPATIAL ENGINE & SAP                                 │
│                                                                                                  │
│   • Streaming AST State Machine: Reads partial NDJSON tokens on the fly (<5ms)                   │
│   • Cassowary Solver (Kiwi.js / ElkJS): Computes deterministic pixel deltas Δ(x, y)              │
│   • Collision & Force Repulsion Pass: Relaxes overlapping boxes dynamically                      │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ (PostMessage: Delta Coordinates & Payloads)
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         TLDRAW REACTIVE CANVAS CORE (MAIN UI THREAD)                             │
│                                                                                                  │
│   • @tldraw/state Signal Store: Direct node mutations (Bypasses React VDOM re-renders)           │
│   • Spring Physics Engine: Smooth cubic-bezier(0.16, 1, 0.3, 1) interpolation                     │
│   • Custom Polymorphic Shapes:                                                                   │
│     ├── <ArtifactShape />: Sandboxed live HTML5 / Tailwind / React / Canvas simulations         │
│     ├── <MediaEmbedShape />: Native YouTube, audio, and web preview players                      │
│     ├── <VectorShape />: Procedural SVG geometric drawings & smart arrow bindings                │
│     └── <CardShape />: Formatted markdown notes & slide layouts                                  │
│   • Single-Tick Undo/Redo: editor.store.atomic() batches tagged with source: 'ai_agent'          │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Pillar 1: The Autonomous Agent Harness

The harness breaks free of the standard "prompt $\rightarrow$ single tool call $\rightarrow$ output" bottleneck by using a three-stage execution pipeline:

```
                          User Prompt & Viewport Context
                                        │
                                        ▼
                   ┌─────────────────────────────────────────┐
                   │    STAGE 1: MACRO-PLANNER (Fast LLM)    │
                   │  • Deconstructs intent into a DAG       │
                   │  • Emits layout skeletons in <150ms     │
                   └────────────────────┬────────────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
  │  Worker 1: Sandbox  │    │  Worker 2: Notes    │    │  Worker 3: Media    │
  │  HTML5 Simulation   │    │  Deep Markdown/Math │    │  YouTube / Vectors  │
  └──────────┬──────────┘    └──────────┬──────────┘    └──────────┬──────────┘
             │                          │                          │
             └──────────────────────────┼──────────────────────────┘
                                        ▼
                   ┌─────────────────────────────────────────┐
                   │    STAGE 3: SPATIAL VALIDATOR           │
                   │  • Code syntax verification             │
                   │  • Force-directed collision relaxation  │
                   │  • Dynamic arrow re-routing             │
                   └─────────────────────────────────────────┘
```

### 1. Speculative Skeleton Placement (<150ms TTFT)
Instead of forcing the user to stare at a spinner while a model reasons:
* The Macro-Planner emits placeholder container bounds (`macroNodes`) within the first 100ms.
* The canvas renders glowing skeleton containers instantly. The user sees the visual architecture forming in real time before content generation begins.

### 2. Modality & Dynamic Tool Routing

| Intent Type | Modality Assigned | Canvas Shape Target | Output Format |
| :--- | :--- | :--- | :--- |
| **Physics, Math, Algorithms, Code** | `SANDBOX_ARTIFACT` | `<ArtifactShape/>` | Standalone HTML5 Canvas, React widget, or Tailwind simulator. |
| **Research, Summaries, Outlines** | `SYNTHESIS` | `<CardShape/>` | Rich Markdown, LaTeX equations, collapsible sections. |
| **Videos, Real-World References** | `MEDIA_SEARCH` | `<MediaEmbedShape/>` | Interactive YouTube player or live web iframe embed. |
| **Systems, User Flows, Trees** | `VECTOR_DRAW` | `<VectorShape/>` + Bindings | Geometric SVG paths and labeled smart arrows. |
| **Direct Card Edits** | `IN_PLACE_MUTATE` | Existing Target Shape | Targeted text stream without shifting adjacent nodes. |

### 3. Hierarchical Parallel Decomposition
For complex tasks (*"Build a 6-part cloud engineering curriculum with simulations"*):
* The Macro-Planner lays out parent containers across the canvas simultaneously.
* Parallel worker streams run concurrently, streaming deep notes into Module 1 while compiling interactive simulations in Module 2 and fetching references in Module 3.

---

## 4. Core Pillar 2: tldraw as the Spatial Substrate

`tldraw` provides the graphics primitives, geometric bindings, and reactive state container that makes AI interaction feel native.

```
                      [ Worker Delta: { id: "card_1", x: 420, y: 180 } ]
                                              │
                                              ▼
                             ┌──────────────────────────────────┐
                             │    editor.store.atomic() Batch   │
                             └────────────────┬─────────────────┘
                                              │
                                              ▼
                             ┌──────────────────────────────────┐
                             │   @tldraw/state Signal Store     │
                             │ (Direct node mutation, NO VDOM)  │
                             └────────────────┬─────────────────┘
                                              │
                                              ▼
                             ┌──────────────────────────────────┐
                             │  Spring Physics / CSS Transform  │
                             │  translate3d(420px, 180px, 0)    │
                             └──────────────────────────────────┘
```

### 1. Signal Store Updates (`@tldraw/state`)
* When the AI streams position changes, mutated SVG/HTML nodes re-render via hardware-accelerated CSS `translate3d` transforms.
* The rest of the board remains idle, sustaining a steady 60 FPS animation loop during active token streaming.

### 2. Atomic Undo/Redo Pipeline
Every AI transformation (moving cards, adding connectors, creating containers) is wrapped in a single transaction:
```typescript
editor.store.atomic(() => {
  editor.updateShapes(aiMutations);
}, { source: 'ai_agent' });
```
A single `Cmd+Z` rollbacks the entire AI action without touching previous manual user edits.

### 3. Native Geometric Arrow Bindings (`TLBinding`)
When the AI creates relationships, it declares logical bindings:
```typescript
editor.createBinding({
  type: 'arrow',
  fromId: 'arrow_1',
  toId: 'card_auth',
  props: { terminal: 'start', isExact: false }
});
```
`tldraw`'s native geometric engine automatically calculates endpoint snapping, obstacle routing, and dynamic trajectory updates.

---

## 5. Core Pillar 3: The In-App Spatial Action Protocol (SAP)

To keep latency under 150ms, SAP decouples semantic intentions from pixel calculations.

```
┌───────────────────────────────────────────────────────────┐
│                     1. Context Culling                    │
│   R-Tree queries viewport -> Generates <300 token prompt  │
└─────────────────────────────┬─────────────────────────────┘
                              │ Streaming Pipeline
                              ▼
┌───────────────────────────────────────────────────────────┐
│              2. Streaming Topological NDJSON              │
│   {"op":"dock","target":"card_jwt","into":"grp_auth"}     │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│               3. Cassowary Constraint Solver              │
│   Calculates exact pixel coordinates in <2ms (Worker)     │
└─────────────────────────────┬─────────────────────────────┘
                              │ PostMessage
                              ▼
┌───────────────────────────────────────────────────────────┐
│               4. Spring Animated Execution                │
│   Cards glide smoothly into position at 60 FPS            │
└───────────────────────────────────────────────────────────┘
```

### 1. Semantic-Geometric Decoupling
* **The LLM outputs relative topology:** `dock_into: "grp_auth"`, `align: "horizontal"`, `repel: "anchor_node"`.
* **The Web Worker solves geometry:** `Kiwi.js` (Cassowary linear simplex algorithm) solves exact pixel positions in under **2ms**.

### 2. Streaming NDJSON Intent Frames
```jsonl
{"t":"patch","op":"speculative_skeleton","id":"skel_1","bounds":{"x":200,"y":100,"w":320,"h":180},"title":"Auth Service"}
{"t":"patch","op":"create_group","id":"grp_auth","title":"Authentication Engine","relative":"right_of:selection"}
{"t":"patch","op":"dock_into","target":"node_login","group":"grp_auth","slot":"top"}
{"t":"patch","op":"dock_into","target":"node_jwt","group":"grp_auth","slot":"bottom"}
{"t":"patch","op":"connect","from":"node_login","to":"node_jwt","label":"validates signature"}
{"t":"patch","op":"spawn_artifact","id":"art_sim","code":"<canvas id='sim'></canvas>...","title":"Token Flow Simulator"}
{"t":"patch","op":"repel_colliding","anchor":"grp_auth","margin":60}
```

### 3. Latency Budget Breakdown

| Phase | Subsystem | Latency SLA |
| :--- | :--- | :--- |
| **Spatial Index Query** | `rbush` 2D R-Tree extraction | **1 – 3 ms** |
| **Transport Uplink** | Streaming HTTP / WebTransport pipe | **10 – 25 ms** |
| **Model TTFT** | Gemini Flash / Fast LLM first token | **70 – 110 ms** |
| **Constraint Solving** | Cassowary linear engine in Web Worker | **1 – 3 ms** |
| **Render Execution** | tldraw signal update + spring animation | **16 ms** (1 frame) |
| **Total First Movement** | **Click to visual card movement on screen** | **~100 – 155 ms** |

---

## 6. Protocols & Data Schemas

### TypeScript Interfaces for Spatial Actions

```typescript
export type ModalityType =
  | 'SANDBOX_ARTIFACT'
  | 'SYNTHESIS'
  | 'MEDIA_SEARCH'
  | 'VECTOR_DRAW'
  | 'IN_PLACE_MUTATE';

export type SpatialOperation =
  | 'speculative_skeleton'
  | 'create_card'
  | 'create_group'
  | 'spawn_artifact'
  | 'embed_media'
  | 'draw_vector'
  | 'dock_into'
  | 'connect'
  | 'align'
  | 'repel_colliding'
  | 'mutate_text'
  | 'delete_shape'
  | 'restyle_shape'
  | 'focus_viewport';

export interface SpatialActionFrame {
  t: 'patch';
  op: SpatialOperation;
  id?: string;
  target?: string;
  anchor?: string;
  group?: string;
  from?: string;
  to?: string;
  title?: string;
  label?: string;
  slot?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  direction?: 'horizontal' | 'vertical' | 'grid';
  relative?: string;
  margin?: number;
  text?: string;
  code?: string; // For HTML5 / React / Canvas simulations
  mediaUrl?: string; // For YouTube / iframe embeds
  color?: string;
  shapeType?: 'geo' | 'note' | 'artifact' | 'frame';
  nodeIds?: string[];
  bounds?: { x: number; y: number; w: number; h: number };
}
```
