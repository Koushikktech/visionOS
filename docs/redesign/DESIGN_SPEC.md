# Design specification: the Studio

## 1. Product and scope

visionOS is a local-first spatial workspace. People sketch, collect and arrange material, ask AI to work with selected content, and create or edit apps, documents, slide decks, notes and code in the same canvas. Its differentiator is seeing and working with the relationships between these outputs.

This redesign covers the entrance, first-use experience, provider setup, canvas controls, AI interaction, artifact frames, focused editors, menus, permissions, recovery and transient states. It preserves the working product's capabilities. It does not build a public homepage, accounts, billing, cloud storage, multiplayer, a project database, or Swarm. A future SaaS layer must fit around this workspace, but no placeholder navigation for it ships now.

Primary users: people trying the product on desktop and iPad. The browser interface uses Apple principles of hierarchy, agency, materials and continuity; it does not imitate native window controls or claim to be an Apple platform application.

**Design thesis:** make the user feel they are entering a place where their ideas already have shape. The signature is an overview of their actual spatial composition becoming the working canvas.

## 2. Current design diagnosis

Full review mode; React/Next.js, Tailwind, shared CSS and Framer Motion. Findings below are source-backed design judgments unless explicitly attributed. Runtime behavior remains to be verified during implementation.

| Severity | Location | Current pattern | Specified replacement and reason |
|---|---|---|---|
| High | `src/components/VisionDashboard.tsx`, hero and section order | Large prompt, four feature cards and account panel precede or compete with the existing workspace | Existing work becomes the primary composition. Returning users should find their work before learning capabilities again. |
| High | Same file, recent-board effect | Reads a localStorage key using the canvas persistence key and looks for `records`; absence becomes 'No recent workspace' | Read a validated workspace summary through the persistence boundary. Unknown, unavailable and empty are distinct states. Never imply data loss from a missing cache. |
| High | Same file, starter actions; `src/components/Canvas.tsx` mount | 'Blank Infinite Canvas' opens the same persisted canvas; some templates are prompts and one is a sample | Use 'Open canvas', 'New page', 'Try an example' and 'Describe an idea' according to actual behavior. Never imply independent workspaces or overwrite a board. |
| High | Dashboard and onboarding provider sections | 'ChatGPT Credits Active', session-token instructions, subscription-credit claims; OpenRouter omitted from these surfaces | One shared provider setup using supported API-key paths. Do not infer credits or subscription entitlements from credential validity. |
| High | `src/app/page.tsx` and `src/components/Canvas.tsx` | Both can initiate onboarding; page passes `editor={null}` into a flow offering canvas actions | One first-use owner, explicit launch intents and editor-ready execution. Every action must reach its advertised destination. |
| Medium | Dashboard, onboarding, shared surface styles | Indigo/cyan/purple ambience, repeated frosted cards, many badges and tiny uppercase labels | Neutral material hierarchy, authored content previews, one action accent, readable type, fewer containers. Distinction comes from the spatial content. |
| Medium | Dashboard hero and template descriptions | 'substrate', 'full-stack', 'spatial intelligence engine', 'Apple-grade' | Concrete verbs and accurate scope: sketch, build, edit, arrange, present. Remove unsupported promises. |
| Medium | Dashboard and onboarding buttons | Repeated `transition-all`; animated decoration on many equally weighted elements | Explicit property transitions and one meaningful overview-to-canvas transition. Routine controls stay quick. |
| Medium | Dashboard root and dialog | `select-none`, repeated nested boxes, very small secondary text; custom settings modal structure | Selectable copy, flat form rows, shared accessible dialog shell, visible labels and useful default text sizes. |

Keep the local-first behavior, floating tools, selected-content AI context, editable artifacts, focus mode, backups, permission choices and guarded recovery. These are product strengths worth making easier to understand.

Coverage: typography, surfaces, motion definitions, icons and performance implications inspected in source. One existing iPad editor screenshot inspected. Computed live styles, current focus paths, touch behavior and animation at 10% playback were not verified. Design verdict: **Needs redesign**; implementation acceptance requires the validation matrix, not this review alone.

## 3. Inspiration and choices

Sources checked on 28 October 2026:

| Reference | Relevant observation | Adopt here | Do not import |
|---|---|---|---|
| [Allume, formerly Muse](https://allume.com/) | Spatial boards mix ink, text and cards; iPad is a central use case | Work presented as a spatial composition; direct manipulation; quiet controls | Its nested-board or sync model, which this app does not currently have |
| [Cosmos](https://www.cosmos.so/) | Visual references and collections carry the experience | Actual work becomes the visual identity; examples use artifact previews | A discovery feed, social functions or unlicensed reference imagery |
| [tldraw showcase](https://tldraw.dev/showcase) | Make Real connects sketches to working websites and iterative feedback | Demonstrate input and output side by side, with a clear action | Copying its UI or implying unimplemented agent capabilities |
| [Apple onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding) | “Teach through interactivity.” | Optional, contextual learning in a real sample page | A blocking instructional carousel |
| [Apple motion](https://developer.apple.com/design/human-interface-guidelines/motion) | “Make motion optional.” | Brief continuity transitions with immediate static equivalents | Persistent ambient activity or delayed access |

The interpretation and visual direction are original design judgments. These references were reviewed through published pages and local guidance, not hands-on competitor testing.

Considered alternatives: an immersive 3D room would consume performance and demand unfamiliar navigation; a masonry project gallery would suggest a project-library data model; a cinematic marketing hero would delay entry; a cream-and-serif editorial theme has little connection to this canvas; liquid-metal buttons would compete with user work. Reject all five for this testing release.

## 4. Visual language

### Composition and material

Graphite workspace, softly lifted opaque panels, precise typography, and colorful work. A cool, pale-blue accent marks primary actions and selection. Blank areas provide scale and calm. Do not add luminous blobs, fake bloom, star fields, rainbow AI borders, decorative statistics, gradients behind every icon, slogan badges or an idle animated orb.

Use translucency only for floating tools above visible canvas content. Cards, text editors and Studio sections have solid materials. One glass layer per area; no blur behind blur. Support an opaque fallback when blur is unavailable or the user prefers reduced transparency. The future implementation may provide an accessibility preference because browser support for reduced-transparency media queries varies.

### Semantic colors

| Role | Dark | Light | Use |
|---|---|---|---|
| Workspace | `#121416` | `#F4F5F6` | Full surface |
| Raised surface | `#1B1E22` | `#FFFFFF` | Preview frame, dialog, editor |
| Primary text | `#F2F3F5` | `#202327` | Titles, body, control labels |
| Secondary text | `#A6ADB5` | `#606872` | Supporting copy and metadata |
| Action text / focus | `#9CB8FF` | `#2454B8` | Links, focus and selected controls |
| Primary button | `#B8CCFF` with `#121416` text | `#2454B8` with white text | One dominant action in a region |

Computed solid-color contrast: dark primary/workspace 16.63:1; secondary/workspace 8.15:1; secondary/raised 7.38:1; action/workspace 9.42:1; dark button 11.53:1. Light primary/workspace 14.45:1; secondary/workspace 5.17:1; secondary/raised 5.64:1; action/workspace 6.34:1; light button 6.92:1. These calculations do not certify glass, disabled states, illustrative text or composited backgrounds; verify those separately.

Use success, caution and error tokens only for meaningful status, with an icon and text. Select actual values during component work and verify contrast; never reduce essential text opacity to achieve hierarchy. Decorative boundaries can be subtle; controls requiring a boundary for identification need 3:1 contrast against their surroundings. Focus: 2px action outline, 3px offset, visible through clipping and on glass.

Default appearance follows the system; preserve existing explicit user preferences if any. Dark and light are complete themes, not filters. Do not recolor user artwork or generated app content when changing application theme.

### Type, geometry and iconography

Use the existing system sans stack. Distinction comes from proportion and composition rather than importing a decorative font. Display: 48/52 at regular width, 36/40 on tablet, 30/34 compact; weight 500, tracking -0.025em. Section title 22/28, weight 600. Body 16/24; touch setup and reading surfaces 17/25. Control labels 14/20, weight 500 or 600. Supporting text 13/18; 12/16 only for nonessential metadata. No 9–11px functional badges. Form inputs at least 16px to avoid iOS focus zoom. Use rem and allow text scaling.

Spacing unit 4px; common spaces 8, 12, 16, 24, 32, 48, 64. Regular content max-width 1280px with 48px side gutters; tablet 24px; compact 16px. Floating controls 12px radius; panels 20px; main preview 24px; pill shape only for compact status and floating tool groups. Nested radii use outer minus padding. No repeated framed box for each line of metadata.

Lucide remains the icon family. 20px normal icons, 16px supporting icons; 1.5px stroke alongside regular text, 2px alongside semibold text. Accessible names are mandatory. Minimum target 44×44 CSS px throughout this touch-capable app; primary touch actions 48px high. Extend hit regions without overlap. No fake keyboard hints on touch-only contexts.

## 5. Studio: information architecture and content

### Header

Left: existing visionOS wordmark, quiet 'Studio' location. Right: 'AI setup' or accurate provider state, Help, Settings. Settings contains AI providers, Appearance/accessibility, Data & backups, About. No avatar, account balance, notification bell, team sidebar, upgrade CTA or marketing navigation.

Do not put a second dominant 'Enter canvas' button in the header. One main continuation action is sufficient. Help offers 'Try the sample', 'Canvas controls', 'About this preview'. Feedback is a later addition only if a real destination is supplied; do not ship a dead link.

### Returning user

Heading: **Back to your canvas.** Supporting line: **Pick up an idea, or make room for another.**

Main region: two columns, approximately 2.2:1. Left is a large preview of the current workspace page: actual spatial bounds, colors and representative content. Right is the page name, 'On this device', truthful last-save/recovery information, primary **Continue canvas**, secondary **New page**, and an **All pages** disclosure if multiple pages exist. 'New page' adds a tldraw page to the same workspace; it does not clear existing pages. Browser Back returns to Studio without replaying an AI request.

The preview is a single accessible open action with a visible label. It is not a nested miniature canvas to pan or pinch. Keep controls outside its image area. For multiple pages, the disclosure presents real page names in a plain list; selecting a page enters that page. No fake recents, invented titles, shape-count scorecards or fabricated timestamps. If metadata is unknown, use 'Open canvas' and 'Your canvas will load when opened.'

Below: a compact **Start something here** composer, placeholder **Describe what you want to make…**. Its action is **Open in canvas**. It opens the composer with an editable draft; sending happens explicitly inside the canvas. The provider/model and selected context are visible before the AI request. This avoids spending a key on a mistaken example tap and removes auto-send ambiguity.

Last: **A few ways to begin**, three curated examples with visual input/output previews and one-line captions. Returning users see these below their own work. No carousel or infinite feed.

### First visit / confirmed empty workspace

Heading: **Give your ideas room.** Supporting line: **Sketch, write, and build together on one canvas.**

Main preview: one authored composition, clearly labeled **Sample canvas**. Arrange a sketch at left, an app at center, a short brief to the right and a slide partly behind it. Use the same coherent subject across all objects: a small creative project called **Field Notes**, with a simple focus timer, a sketch, a two-section brief and three-slide presentation. Its purpose is to show multiple editable forms sharing one spatial context, not to pitch a generic startup.

Primary **Open canvas** creates/opens the empty working page. Secondary **Try the sample** opens a dedicated sample page after the editor is ready. Tertiary **Restore a backup** opens the existing guarded restore flow. No API key required to enter, draw, edit local material or explore the bundled sample.

The sample is a planned new local fixture, not a claim about the current calculator. Bundle HTML/CSS/JS with no external fonts, scripts, images or telemetry; do not require a permission prompt for the first successful interaction. Do not execute sample code in the Studio preview. Sample insertion must be undoable and safe against repeated taps. On a populated workspace, explicitly add a sample page, never replace an existing page.

### Curated examples and exact behavior

| Title | Preview content | Caption | Action |
|---|---|---|---|
| From sketch to app | A simple drawn timer next to its finished face | Turn a rough interface into something you can use. | Open example detail; 'Try this example' inserts the local sample page. 'Make your own' opens a blank drawing page with a dismissible selection hint. |
| Give a brief its shape | Two-section brief alongside three slide thumbnails | Keep the thinking beside the presentation. | Insert a local editable brief/deck example on a new page; no automatic AI request. |
| Think in connections | Notes connected to a small decision diagram | Move ideas around until the relationships make sense. | Insert a local note/connector example on a new page. |

Each detail shows what is bundled versus what requires AI. Example cards use authored content, not generic icon tiles. On regular widths use 3 columns, tablet 2, compact 1. No claim of dynamic app generation while a static sample is running. Do not add unsupported import types or pre-populated external URLs.

### Layout sketches

```text
REGULAR, >= 1100px
visionOS / Studio                                  AI setup   Help   Settings

Back to your canvas.
Pick up an idea, or make room for another.

+----------------------------------------------+   PAGE NAME
|                                              |   On this device
|         actual spatial composition           |   truthful saved state
|                                              |   [ Continue canvas -> ]
|                                              |   New page    All pages
+----------------------------------------------+

Start something here     [ Describe what you want to make...      Open in canvas ]
A few ways to begin
[ sketch -> app preview ] [ brief -> slides preview ] [ connections preview ]
```

```text
COMPACT / NARROW SPLIT VIEW
visionOS / Studio                  Help   Settings
Back to your canvas.
[ actual spatial preview, 16:10 ]
Page name · On this device
[ Continue canvas                  ]
New page             All pages
[ Describe an idea...              ]
[ Open in canvas                   ]
Examples: stacked with visible labels
```

At 768–1099px retain generous preview width; place metadata/actions below it if the remaining rail would be below 240px. At less than 768px use one column. Container width, not device naming, determines the layout. At short landscape heights allow page scroll; never shrink text to fit a one-screen composition.

## 6. First use and AI setup

Remove the mandatory four-step onboarding. Entering the canvas optionally shows a small **Try one thing** hint: 'Add a note, draw a shape, or ask AI.' It has a visible dismiss action. A sample tour consists of three contextual, dismissible tips: move a note; select the sketch; inspect the finished app. Show only the tip relevant to the current action. No completion ceremony, forced order, progress dots or repeated prompts on return. Help can restart it.

One controller owns first-use state. Loading with `?view=canvas` enters the canvas without a dashboard flash or competing modal. With unavailable browser storage, dismissal persists for the session; it must not reopen repeatedly in the same visit.

AI setup opens on explicit request or when the user presses Send without a usable key. Preserve the unsent prompt and selection context. Desktop dialog 520px max width; touch/compact full-width inset sheet, bounded by visible viewport, internally scrollable body and reachable footer. Title **Connect an AI provider**. Text **Use your own API key. You can keep using the canvas without one.**

Providers: Gemini, OpenRouter, and OpenAI only where backed by working request adapters. Use one configuration contract across Studio, onboarding replacement and canvas. Do not ship session-token entry or an unverified OAuth button. Keep model selection inside setup, with a sensible default and expandable advanced options. Do not hard-code marketing claims about current model capabilities, pricing or credits.

Form: provider choice, API-key label, masked field, accessible Show/Hide, actual storage-mode disclosure, **Save key** or **Check and save** only if validation really occurs. Distinguish 'Key saved', 'Key checked', 'Check failed', and 'Storage unavailable'. A key's presence never means funded credit. Connection errors preserve the entered key and draft. Closing cancels the setup flow, not the user's work. After success return to the preserved composer; do not silently send.

Privacy copy must reflect actual storage and routing. Baseline: **AI requests send your prompt and relevant canvas content through this site's server to your chosen provider.** Storage text varies: 'Key saved in this browser', 'Key available for this session', or 'Key available while this page is open'. Never claim encrypted-at-rest keys, exclusively on-device AI or guaranteed offline app loading.

## 7. Canvas redesign

The canvas and Studio share type, palette, spacing and control treatments. The work owns the screen. Keep tldraw interaction semantics and existing safety boundaries.

Top left: small Studio/back control and page switcher. Top right: a quiet save status with a named action opening Data & backups, plus utility menu. Persistent safety problems become a compact non-dismissable status until resolved, with explanatory details on demand; avoid a perpetual success banner.

Bottom center: floating tool dock with Select, Pan, Draw, Text, Note, Shapes and insertion overflow, retaining all existing tools and shortcuts. Consolidate chrome visually, but do not delete capabilities. Tool options appear adjacent to the chosen tool; advanced options live in a popover. On narrow screens use two purposeful groups or overflow, not a horizontally clipped dock. Undo/redo and viewport actions remain reachable through touch controls and keyboard.

AI: one visible **Ask AI** control opens the existing composer. Expanded desktop panel max-width 600px; on compact widths use a viewport-bound sheet. Display context before input: **3 selected objects**, or **Current view**. Context chip opens an explanation of included material; no invented preview or object count. Enter sends in the established desktop mode, Shift+Enter adds a line; touch has a visible Send. Preserve IME composition behavior and drafts when closing. Never hijack typing or system browser shortcuts.

AI states: idle, sending, working, applying changes, complete, cancelled, failed, partially applied/recovered. Labels come from real events. Do not rotate invented technical status or display model reasoning as a reliable progress meter. Stop stays reachable. Show meaningful completion summaries such as 'Added a document and 3 notes', with Undo only when supported by the actual operation boundary. Do not promise complete rollback if the operation reported partial recovery.

Place speculative geometry only when real candidate bounds exist. A quiet outline and 'Creating…' communicates placement. No multicolor beam. During prolonged work show elapsed duration or neutral indeterminate activity, never fake percentages. Selection context and prompt remain inspectable.

## 8. Artifact frames, editors and safety

All native artifact frames share a title row, type label where useful, one primary action, focus/expand and an overflow menu. Avoid five competing icons and permanent toolbar rows inside every card. App states must be explicit: preview paused, running, needs site access, error. 'Interact' versus 'Move' remains understandable for touch; canvas gestures must not become trapped inside iframe content.

Documents: reading-first surface with clear title, subtitle only when present, comfortable line length and readable text. Focus editing uses a section navigator on wide screens, a section dropdown on compact screens, and a large writing area. Stop giving metadata fields the same emphasis as the document body. Keep exports and draft protection.

Slides: the slide dominates; compact pager and Present are primary. Slide structure and style controls appear in focused editing. Preserve editable PowerPoint export. Code: readable monospace, copy/run/edit separated by purpose; do not add a new code-editor dependency merely for cosmetic polish. Notes: clear fill, readable type and a restrained selected state. Media: loading and unavailable states remain distinguishable from an empty shape.

Permission dialogs use the same shell as setup, with exact destination origins, requested versus already allowed access, scope and persistence choices. Keep the existing separate peer-connection decision and source-version restrictions. Do not turn permission prompts into generic 'Continue' dialogs or remember permissions by default. Confirmed external links remain separate. Important caveats must stay readable, with details progressively disclosed without hiding the decision's consequence.

Data & backups lists current on-device status, Download backup, Restore backup and recovery review when available. Restore preview shows what will change and uses existing conflict/write guards. A recovery copy is not a cloud backup; 'Saved' must identify what was actually saved. Storage failures remain actionable and never disappear behind reassuring green dots.

## 9. Signature motion specification

| Moment | Behavior | Timing | Reduced motion / fallback |
|---|---|---|---|
| Continue canvas | Preview frame expands toward the canvas viewport, using the same static preview until the real page is ready; surrounding Studio content fades | 360–420ms transform/opacity, `cubic-bezier(0.2,0,0,1)` | Immediate swap or <=100ms opacity; no zoom |
| Return to Studio | Short crossfade; restore Studio scroll and focus to Continue | 160ms | Immediate |
| First authored sample reveal | Sketch, app, brief appear in reading order once; maximum 3 groups | 240ms total, 40ms offsets; movement <=8px | All immediately visible |
| Settings/sheet | 8px displacement and opacity, no spring overshoot | 180–220ms in, 140ms out | Opacity only |
| Example hover/focus | Surface lift/outline; no tilt or pointer chasing | <=140ms | Static outline |
| Small button press | Existing 0.96 scale where appropriate | <=100ms, interruptible | Color response only |
| Loading | Single local activity indicator with textual state | Only while work is pending | Static label remains |

The overview transition is progressive enhancement. If preview correspondence is missing, snapshots are stale, the canvas is slow, or the device struggles, crossfade immediately and retain the existing launch fallback. Never delay interactive readiness to finish choreography. Do not animate a fake geometry match. No loop on idle Studio. No scroll hijacking, custom cursor, sound by default, or device-orientation parallax. The transition image is inert and aria-hidden; focus moves only after the destination is ready.

## 10. State and interaction contract

| State | Visible result | Allowed next action |
|---|---|---|
| Workspace being checked | Quiet static preview placeholder; 'Checking this device…' | Open canvas remains available; never show an empty-workspace claim |
| Verified empty | Authored sample preview labeled Sample; normal blank entry | Open, sample, restore |
| Existing | Actual page overview, real title and available metadata | Continue, new page, other pages |
| Preview unavailable | Neutral page frame and actual title where known | Continue; no fake content |
| Storage blocked | 'Changes may not survive closing this page' with details | Work, download backup where available; no persistent-save claim |
| Recovery conflict | 'A recovery copy needs review' | Existing guarded review; no automatic replacement |
| Offline | Local work remains usable if app is loaded; AI has unavailable state | Edit, export; draft AI input for later |
| Provider missing/invalid | Draft retained; setup or correction action | Manual work or connect/correct provider |
| Slow canvas launch | Existing launch status and retry/recovery path | Retry without duplicating sample or AI action |
| Existing user plus sample request | Clearly labeled new sample page | Existing pages untouched; undoable insertion |
| Empty prompt | Open canvas without generation, or disabled draft-open action with clear label | Never issue an empty AI request |

Keyboard: logical DOM order matching visual order, visible focus, Escape closes the topmost dismissible layer, focus returns to the opener, tab trap only in modal dialogs. No nested buttons in preview cards. Text and origins are selectable. Status live regions announce meaningful state changes, not every stream token.

iPad: 44px targets, no hover-only actions, no drag-only navigation, regular visible controls for every gesture feature, no right-click dependency. Preserve existing pinch and card-scroll routing. Respect visualViewport, safe areas, browser bars and the software keyboard. Sheets must fit 320px narrow layouts and short landscape windows without clipped actions. Test Pencil without promising hardware support based only on touch emulation.

## 11. Design quality gates

The first implementation review must show Studio empty and populated, narrow iPad, provider setup and the canvas AI composer using the new system. Do not approve a token-only recoloring of the existing grid.

Specific pass criteria: the user's work is visible above fold at 1440×900 and 1024×768; the primary action is obvious within one glance; a first visitor can enter without credentials; all essential actions work without hover; one coherent example demonstrates sketch/app/document/slide relationships; no fake project collection, metric or credit balance; no repeated onboarding; no new network permission required by the bundled sample; no decorative idle motion; browser back/forward does not replay operations; old work survives theme and navigation changes.

Aesthetic self-check: remove one accessory before adding an effect. In this proposal the redundant hero badge, duplicate header CTA and provider summary card have been removed. The remaining distinctive element is the actual spatial preview and its continuity into the canvas. This belongs specifically to this product and must not be replaced by a stock gradient illustration.

## 12. Guidance basis and limits

Local Apple references read: accessibility, layout, typography, color, designing-for-iOS, onboarding, motion, generative-AI, materials and cross-platform guidance. Apple foundations are translated to web semantics, not treated as a requirement to imitate native tab bars or desktop menu bars.

Relevant rules: `layout.md › Visual hierarchy` prioritizes important content in reading order; `color.md › Best practices` assigns stable meanings to colors; `typography.md › Ensuring legibility` requires readable sizes; `onboarding.md › Best practices` favors interaction and optional contextual tips; `motion.md › Best practices` makes motion purposeful and optional. Interface-polish principles applied: concentric geometry, optical alignment, explicit transition properties, interruption, consistent icon weights and minimum hit regions. Live accessibility and performance certification is an implementation task, not a property of this document.
