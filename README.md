<div align="center">

# 🥽 visionOS

### AI-Native Spatial Operating System on an Infinite Canvas

[![Next.js 15](https://img.shields.io/badge/Next.js-15.5-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![tldraw v3](https://img.shields.io/badge/tldraw-v3.15.6-purple?style=flat)](https://tldraw.dev/)
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
- Live apps run in a layered opaque-origin iframe preview with an isolated virtual `localStorage` bridge so apps retain state across canvas moves, zooms, and page reloads without sharing storage with other shapes.
- External site access starts off. When the app requests a site, review its exact HTTPS origin and allow it for this run or remember it for this code version. Scripts from an allowed site can read the app's saved data and send it to that site. Imported apps stay paused; source edits and workspace restores reset grants. Forms and embedded sites remain blocked. Clicked HTTPS links require a separate host confirmation.

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
- Users can provide their own Google Gemini, OpenAI, or OpenRouter API key directly in the browser. OpenAI access uses an OpenAI API key; ChatGPT subscription sign-in is not supported.
- **Browser-held BYOK**: Keys use this browser's local storage when available, fall back to the current tab session when persistent storage is blocked, or remain in memory only when browser storage is unavailable. AI requests send the key and relevant canvas context to this app's server, which forwards them to the selected provider. The production test deployment ignores host provider keys.
- Pre-configured presets for `gemini-3.8-flash` (recommended default), `gemini-3.5-flash-lite`, and `gemini-4-argon`, plus OpenAI and OpenRouter.

### 7. ⏪ Single-Tick Atomic Undo/Redo (`Cmd+Z`)
- Every multi-node layout or AI operation is batched inside an atomic CRDT transaction (`editor.store.atomic()`).
- Pressing `Cmd+Z` rolls back the entire AI action cleanly in one tick without disturbing previous user actions.

## On-device canvas recovery

The **Export** menu's **On-device recovery** status reports **Checking recovery copy**, **Saving recovery copy**, and **Recovery copy saved on this device**. “Saved” means the app-owned IndexedDB recovery transaction committed the board records; it is separate from tldraw's private native persistence acknowledgement. A mismatch or storage error is shown without automatically replacing either copy. Review both snapshots before choosing **Keep current** or **Restore recovery**; the choices are fenced to the reviewed copy revision and live canvas snapshot. Restore saves the current workspace first so **Restore previous** remains available.

Use **Export → Download workspace backup** for a portable versioned workspace backup. The on-device recovery copy contains canvas records and asset references, not packaged media bytes. Version 2 downloads include supported app virtual storage, package supported local media, and report exclusions for items that could not be embedded. Provider keys, chat history, and app preferences are not included. This recovery is local to the current browser profile: clearing site data or browser storage eviction can remove it. Abrupt termination before the recovery transaction commits is not guaranteed to preserve the latest edits.

The recovery copy is bounded to 50,000 records and 25 MB of board records, with a 16 MB pending-change queue. If a limit or browser-storage failure is reached, the canvas remains usable but the status asks you to download a workspace backup. Automatic restore requires browser Web Locks support and fails closed when that coordination is unavailable.

---

## 🏛️ System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AUTONOMOUS SPATIAL HARNESS                                │
│                                                                                        │
│   • 2D R-Tree Spatial Indexing (rbush): Extracts selected shapes + 1.3x active viewport │
│   • Gemini, OpenAI, OpenRouter SSE: token streaming & tool parsing                  │
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

   For the test deployment, leave provider keys blank. Testers add their own Gemini, OpenAI, or OpenRouter API key in onboarding/settings. OpenAI access uses an OpenAI API key; ChatGPT subscription sign-in is not supported. For local development only, you may opt into a server key by setting `ALLOW_SERVER_AI_KEYS=true` and configuring a provider key; this opt-in is ignored in production.

   Example local-only configuration:
   ```env
   # Optional local server-funded development. Do not use on deployed test instances.
   ALLOW_SERVER_AI_KEYS=true
   GEMINI_API_KEY=your_local_development_key
   GEMINI_MODEL=gemini-3.8-flash

   # Optional: OpenAI API key for local development
   OPENAI_API_KEY=
   OPENAI_MODEL=gpt-4o

   # Optional: OpenRouter API Key (https://openrouter.ai/keys)
   OPENROUTER_API_KEY=
   OPENROUTER_MODEL=openai/gpt-4o
   ```

   > **Note:** The app's deployed test instance is BYOK-only. Provider keys stored in deployment environment variables are not used in production, even if present. Each tester enters their own key. It is stored persistently in that browser when possible, in the current tab session if persistent storage is blocked, or in memory if browser storage is unavailable. The key and relevant canvas context are sent to the app API for forwarding to the selected provider.

4. **Start the development server:**
   ```bash
   bun run dev
   # or: npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing & Verification

At the latest 27 Oct 2026 checkpoint, 454 tests passed across 48 files with zero failures; typecheck and production build passed. The earlier 429-test / 45-file checkpoint is retained in the audit history. These checks are local evidence, not a deployed-service or physical-device certification.

```bash
# Run the test suite (latest 27 Oct checkpoint: 454 passed across 48 files)
bun test

# Run TypeScript typecheck
bun run typecheck

# Run production build
bun run build
```

### Latest local browser verification — 27 Oct 2026

Production Chromium and headless WebKit passed the responsive editor matrix, dock selection/focus-return checks, rotated-geometry mutations, controlled action/backup rollback, worker race guards, dummy-key storage scenarios, and the exercised generated-app permission flows. Exact-site approval, denial of unapproved destinations, storage preservation across a permission reload, manual confirmation for clicked external links, remembering and revoking grants, and source-change revocation were checked locally. At canvas zoom 33%, the unscaled Website access toolbar action measured 44×44 CSS pixels. The permission evidence note records scope and limits. A synthetic dictation fixture passed in Chromium; the WebKit audio fixture is still under investigation. CDN-hosted fonts and translations depend on network availability: an early reload that canceled those requests emitted WebKit load diagnostics, while waiting for `networkidle` produced no app changes or fatal error. Physical iPad/Safari/Pencil/VoiceOver, live provider calls, and deployed behavior remain unverified. See the [Oct 27 audit and evidence index](docs/PRODUCTION_AUDIT_PLAN.md), [browser evidence README](docs/audit-evidence-2026-10-27/README.md), and generated-app [network permission evidence](docs/audit-evidence-2026-10-27/network-permissions/README.md).

---

## ☁️ Deploying to Vercel

visionOS is engineered for production deployment on [Vercel](https://vercel.com):

### 1-Click Deploy via Vercel Dashboard

1. Push your repository to GitHub (`visionOS`).
2. Go to [Vercel](https://vercel.com/new) and click **Import Project**.
3. Select your `visionOS` repository.
4. Set the Framework Preset to **Next.js** (detected automatically).
5. Optionally set `GEMINI_MODEL`, `OPENAI_MODEL`, and `OPENROUTER_MODEL` under Project Settings. Do not configure provider API keys for the test deployment; each tester supplies their own key in the app.
6. Click **Deploy**.

### Production Vercel Notes
- **Serverless Streaming**: Next.js App Router streaming endpoints (`/api/ai/chat` and `/api/ai/make-real`) use server-sent events (SSE). Vercel natively supports streaming on standard and Pro plans.
- **BYOK test deployment**: Provider environment keys are ignored in production. Users are prompted by onboarding to enter their own key; the app forwards each request to the chosen provider using that key. This keeps the test instance from spending a host-owned provider quota.

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

- **Generated-app preview boundary**: A trusted opaque-origin wrapper hosts each generated app in a nested Blob-backed iframe. The tested outer boundary disallows forms, popups, and top-level navigation; the parent canvas DOM and cookies are not exposed to app code. This is a browser boundary, not a guarantee that every network-capable API is contained.
- **Exact-site permissions**: HTTPS resources and HTTPS/WSS connections are blocked unless the user approves an exact origin, including its port. Remembered grants are stored in this browser and bound to the workspace, app shape, restore epoch, and exact source version; they are not part of the board or its backups. A clicked HTTPS link is shown to the user before it opens. Peer-to-peer APIs are a separate advanced option and are only best-effort blocked in browser previews; WebRTC may bypass the runtime guard. Do not treat this preview as a complete network firewall or as offline.
- **Virtual LocalStorage Isolation**: Generated apps receive an isolated, key-value virtual storage layer managed by the host. An app cannot access or tamper with data belonging to other canvas apps.
- **Provider credentials and requests**: Environment variables without `NEXT_PUBLIC_` stay on the server. A browser-entered key is stored in local storage where available, otherwise in the current tab session or memory only, and is sent with relevant canvas context to this app's API; the server forwards the request to the selected provider. The app does not put Gemini keys in provider request URLs. Settings indicate the active persistence level and warn if a removal could not clear a saved copy.
- **Local-first data**: Workspace state and chat history are stored in the browser. AI requests send the prompt and relevant canvas context to this app's server and provider; some workflows may also include a canvas snapshot. Voice dictation uses the browser's speech-recognition service, whose data handling depends on the browser and its provider. Remove keys in settings; if browser storage prevented a saved copy from being cleared, the UI warns that it could return after reload.

---

## 📄 License

The visionOS project code is licensed under the [MIT License](LICENSE). The `@tldraw/tldraw` v3.15.6 dependency has its own license; its required verbatim notice is included in [THIRD_PARTY_NOTICES/tldraw-3.15.6-LICENSE.md](THIRD_PARTY_NOTICES/tldraw-3.15.6-LICENSE.md). The project MIT license does not replace that dependency license.
