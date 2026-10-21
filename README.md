<div align="center">

# 🥽 visionOS

### AI-Native Spatial Operating System on an Infinite Canvas

[![Next.js 15](https://img.shields.io/badge/Next.js-15.5-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5.8-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![tldraw v3](https://img.shields.io/badge/tldraw-v3.8-purple?style=flat)](https://tldraw.dev/)
[![Bun](https://img.shields.io/badge/Bun-1.3-orange?style=flat&logo=bun)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

*A local-first, Apple visionOS-inspired spatial computing workspace. Transform natural language and hand-drawn wireframes into living, interactive applications, presentation decks, and structured intelligence directly on an infinite canvas.*

---

</div>

## 🌌 Overview

**visionOS** replaces traditional conversational sidebars with an active spatial collaborator operating directly on an infinite canvas. Instead of trapping AI intelligence inside isolated chat bubbles, visionOS treats the entire canvas as a shared interactive canvas substrate where text, drawings, live applications, slide decks, and code exist in a cohesive spatial topology.

Inspired by Apple visionOS and macOS Sequoia liquid glass aesthetics, the interface features deep obsidian translucency (`backdrop-blur-3xl`), concentric border radii geometry, micro-spring tactile physics, and a floating HUD system designed to stay out of the user's creative flow.

---

## ✨ Key Features

### 1. 🪄 Make Real: Sketch to Live Interactive Sandbox
- Select any hand-drawn wireframe, sketch, or group of shapes and click **Make Real** (or press `Cmd+K` and ask the assistant).
- visionOS extracts spatial bounds and SVG/raster context, feeds it to a multimodal vision model (Gemini / GPT-4o), and synthesizes a full, self-contained HTML5/CSS/JavaScript web application placed cleanly on the canvas.
- Live apps run in sandboxed, opaque-origin iframes with an isolated virtual `localStorage` bridge so apps retain state across canvas moves, zooms, and page reloads without leaking data to other shapes.

### 2. 🧠 Spatial Intelligence Omnibar (`Cmd+K`)
- **macOS Sequoia Siri-Inspired HUD**: Floating obsidian liquid glass panel with circular dismiss/expand controls, smooth spring animations, and quiet visual polish.
- **Gemini Thinking Telemetry**: Native support for Gemini thinking models (`thinkingBudget: 2048`, stream-parsed `<thought>` blocks) with expandable thought accordions and rotating status phrases while reasoning.
- **Voice Dictation**: Natural hands-free control powered by the browser Web Speech API with real-time interim transcription directly into the command bar.
- **Context-Aware Spatial Actions**: The AI automatically inspects your selected shapes, nearby viewport geometry, and canvas topology to refine, align, restyle, or regenerate components in place.

### 3. 📐 Kiwi.js Constraint Solver & Non-Overlapping Placement
- **Semantic-Geometric Decoupling (SAP Protocol)**: The AI never computes raw `(x, y)` pixel coordinates. Instead, the AI emits topological intents (`create_card`, `dock_into`, `spawn_artifact`, `repel_colliding`).
- A client-side Cassowary linear simplex constraint solver (`kiwi.js`) runs inside a dedicated Web Worker (`spatial.worker.ts`) to compute deterministic pixel coordinates in `<3ms`.
- Newly generated apps and cards automatically avoid existing canvas shapes, eliminating accidental overlaps.

### 4. 📊 Polymorphic Native Canvas Shapes
- **Interactive Sandboxes (`ArtifactShape`)**: Live dashboards, calculators, games, forms, and charts with isolated storage.
- **Slide Decks (`SlideDeckShape`)**: Gamma-grade presentation decks with smart layouts (Hero, Multi-Column, Big Stats, Timeline, Quote), dark obsidian and liquid glass themes, keyboard navigation, fullscreen presentation mode, and PPTX export.
- **Longform Documents (`DocShape`)**: Structured reports with sticky collapsible Table of Contents, LaTeX math formulas rendered with KaTeX, syntax-highlighted code blocks, and 1-click Markdown export.
- **Rich Cards & Code Cards (`RichCardShape`, `CodeCardShape`)**: Obsidian glass cards with Markdown support and syntax-highlighted code blocks.
- **Media Embeds & Vectors (`MediaEmbedShape`, `VectorShape`)**: YouTube, audio, and web preview players connected by smart directional arrows.

### 5. 🎨 Apple Human Interface Guidelines (HIG) Craft
- **Concentric Border Radii**: Strict geometric formula ($R_{\text{outer}} = R_{\text{inner}} + \text{padding}$) across all nested pills, popovers, and containers.
- **Tactile Micro-Interactions**: All clickable buttons feature $\ge 40\times 40\text{px}$ touch targets with tactile scale feedback (`active:scale-[0.96]`).
- **Tabular Numerics**: `tabular-nums` typography on all zoom percentages, timers, slide numbers, and latency badges to eliminate layout shifts.
- **Motion Restraint**: Fluid interruptible springs (`cubic-bezier(0.2, 0, 0, 1)`) with zero distracting neon borders or cyberpunk clutter.

### 6. 🛡️ Privacy-First First-Time Onboarding
- First-time users are greeted with an interactive visionOS onboarding modal.
- Users can provide their own Google AI Studio API key directly in the browser.
- **Zero Server Key Storage**: Client-provided keys are saved *strictly* inside the browser's local storage and are never exposed or transmitted to any third party.
- Pre-configured presets for `gemini-3.8-flash` (recommended default), `gemini-3.5-flash-lite`, and `gemini-4-argon`, plus OpenRouter.

### 7. ⏪ Single-Tick Atomic Undo/Redo (`Cmd+Z`)
- Every multi-node layout or AI operation is batched inside an atomic CRDT transaction (`editor.store.atomic()`).
- Pressing `Cmd+Z` rolls back the entire AI action cleanly in one tick without disturbing previous user actions.

---

## 🏛️ System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AUTONOMOUS SPATIAL HARNESS                                │
│                                                                                        │
│   • 2D R-Tree Spatial Indexing (rbush): Extracts selected shapes + 1.3x active viewport │
│   • Gemini / OpenRouter Streaming SSE: High-throughput token streaming & tool parsing  │
│   • Thinking Engine: Upstream thinking budget parsing (<thought> streaming blocks)     │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ (NDJSON Token Stream / SAP Frames)
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                     SPATIAL WORKER (spatial.worker.ts)                                 │
│                                                                                        │
│   • Cassowary Linear Simplex Solver (Kiwi.js): Solves layout constraints in <3ms       │
│   • Force-Directed Collision Pass: Relaxes overlapping boxes & avoids canvas obstacles │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ (PostMessage: Deterministic Coordinates)
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   VISIONOS REACTIVE CANVAS CORE (Main UI Thread)                       │
│                                                                                        │
│   • @tldraw/state Signal Store: High-performance 60 FPS direct canvas updates         │
│   • Floating HUD: Bottom Island Dock, Zoom Tabular Pill, Contextual Formatting Pill    │
│   • Speculative Skeleton Overlay: Shimmering placement preview during AI generation    │
│   • Sandboxed Iframe Runtime: Isolated opaque-origin sandboxes with storage bridge     │
│   • Atomic History Stack: Single-tick Cmd+Z rollback boundary for every AI mutation    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: `v20.0.0` or later
- **Bun**: `v1.3.0` or later (recommended for rapid development and testing)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Koushikktech/visionOS.git
   cd visionOS
   ```

2. **Install dependencies:**
   ```bash
   bun install
   # or: npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

   Add your Google AI Studio or OpenRouter API key:
   ```env
   # Google AI Studio API Key (Get free key: https://aistudio.google.com/app/apikey)
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-3.8-flash

   # Optional: OpenRouter API Key (https://openrouter.ai/keys)
   OPENROUTER_API_KEY=
   OPENROUTER_MODEL=openai/gpt-4o
   ```

   > **Note:** If you do not configure server-side keys in `.env.local`, you can still enter your Gemini API key directly into the client-side Onboarding Modal upon launching the app. The key is securely stored in your browser's `localStorage`.

4. **Start the development server:**
   ```bash
   bun run dev
   # or: npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing & Verification

visionOS is covered by a comprehensive 244-test automated verification suite verifying concentric geometry, tactile hit-targets, token boundaries, markdown fence sanitization, and spatial solver algorithms.

```bash
# Run complete test suite (244 tests)
bun test

# Run TypeScript typecheck
bun run typecheck

# Run production build
bun run build
```

---

## ☁️ Deploying to Vercel

visionOS is engineered for production deployment on [Vercel](https://vercel.com):

### 1-Click Deploy via Vercel Dashboard

1. Push your repository to GitHub (`visionOS`).
2. Go to [Vercel](https://vercel.com/new) and click **Import Project**.
3. Select your `visionOS` repository.
4. Set the Framework Preset to **Next.js** (detected automatically).
5. Add the following **Environment Variables** under Project Settings:
   - `GEMINI_API_KEY`: Your Google AI Studio API key.
   - `GEMINI_MODEL`: `gemini-3.8-flash` (or your preferred model).
   - *(Optional)* `OPENROUTER_API_KEY`: Your OpenRouter key.
6. Click **Deploy**.

### Production Vercel Notes
- **Serverless Streaming**: Next.js App Router streaming endpoints (`/api/ai/chat` and `/api/ai/make-real`) use server-sent events (SSE). Vercel natively supports streaming on standard and Pro plans.
- **Client Key Option**: Even if you leave `GEMINI_API_KEY` blank on Vercel, users will be prompted by the interactive Onboarding Modal to enter their own API key, allowing you to host a completely zero-cost public or demo instance without exposing your personal API quota!

---

## 🗂️ Project Structure

```
visionOS/
├── src/
│   ├── app/                      # Next.js 15 App Router
│   │   ├── api/ai/               # AI endpoints (chat, make-real, swarm)
│   │   ├── globals.css           # Apple visionOS glass tokens & typography
│   │   ├── layout.tsx            # Root layout with metadata
│   │   └── page.tsx              # Main entrypoint & spatial loader
│   ├── components/               # UI & Canvas Components
│   │   ├── AppleFloatingDock.tsx # Floating bottom island dock
│   │   ├── AppleViewportPill.tsx # Tabular zoom percentage & undo/redo
│   │   ├── ApplePagesPill.tsx    # Top visionOS Spatial branding emblem
│   │   ├── Canvas.tsx            # Main tldraw canvas host (hideUi={true})
│   │   ├── ContextualFloatingMenu.tsx # In-situ selection styling pill
│   │   ├── SpatialAIOmnibar.tsx  # Siri-inspired AI command bar (Cmd+K)
│   │   ├── VisionOnboardingModal.tsx # First-time user onboarding modal
│   │   └── SpeculativeSkeletonOverlay.tsx # Live generation placement preview
│   ├── hooks/                    # React Hooks
│   │   ├── useSpatialAI.ts       # Spatial AI orchestration & streaming
│   │   └── useSpatialWorker.ts   # Web Worker communication & solver bridge
│   ├── lib/                      # Core Utilities & Tokens
│   │   ├── ai/                   # Prompt templates, tool conversion, actions
│   │   ├── spatial/              # Geometry, R-Tree grounding, make-real logic
│   │   ├── tokens.ts             # Concentric border radii, tactile physics
│   │   └── sanitizeHtml.ts       # Strict HTML code-fence sanitization
│   ├── shapes/                   # Custom tldraw Polymorphic Shapes
│   │   ├── ArtifactShapeUtil.tsx # Sandboxed interactive apps & virtual storage
│   │   ├── SlideDeckShapeUtil.tsx# Presentation decks with themes & PPTX export
│   │   ├── DocShapeUtil.tsx      # Longform documents with LaTeX & outline
│   │   ├── RichCardShapeUtil.tsx # Markdown notes & cards
│   │   ├── CodeCardShapeUtil.tsx # Syntax-highlighted code blocks
│   │   ├── MediaEmbedShapeUtil.tsx# YouTube & media embed cards
│   │   └── VectorShapeUtil.tsx   # Procedural vector shapes & connectors
│   └── workers/
│       └── spatial.worker.ts     # Kiwi.js Cassowary layout solver in Web Worker
├── docs/                         # Technical documentation & blueprints
├── public/                       # Static public assets
├── .env.example                  # Environment variable blueprint
└── package.json                  # Dependencies & scripts
```

---

## 🔒 Security & Privacy

- **Opaque-Origin Iframe Sandboxing**: All AI-synthesized interactive applications run inside `<iframe sandbox="allow-scripts allow-forms allow-modals">` on an opaque origin. The parent canvas DOM, cookies, and tokens are completely inaccessible to generated apps.
- **Virtual LocalStorage Isolation**: Generated apps receive an isolated, key-value virtual storage layer managed by the host. An app cannot access or tamper with data belonging to other canvas apps.
- **Zero Server Key Exposure**: Environment variables without `NEXT_PUBLIC_` remain strictly on the server. Client-provided keys never leave the browser except via encrypted direct HTTPS requests to provider endpoints.
- **Single-Tenant & Privacy**: Full canvas states and user chats reside strictly in the browser's indexed/local storage.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
