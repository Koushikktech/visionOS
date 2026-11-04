# Studio glass redesign — 28 October 2026

This iteration follows the user's new request and attached Siri panel as visual reference. Text inside the screenshot is reference content, not an instruction. The previous handoff supplies product constraints; the new brief supersedes its visual direction.

## Product and direction

visionOS is a local spatial creation workspace. The entrance should help a person continue real work, start a blank page, bring an idea into an editable AI draft, or learn by opening a real example. It should not imply accounts, sync, credits, saving, or existing work without evidence.

The signature is a floating, rounded assistant with a near-black or pearl glass frame, circular controls and a recessed input. The same material frames navigation and window controls. Reading and editing surfaces remain opaque enough for sustained work. This is a browser approximation, not Apple's native material.

## Review and implementation plan

| Severity | Surface | Before | Intended change | Reason |
| --- | --- | --- | --- | --- |
| High | First-use Studio | Large empty preview, repeated loading copy, creation below fold | Useful starter composition, clear first action and compact draft flow | A new visitor needs to understand what to do |
| High | Theme system | Old dark-only material rules followed by multiple overrides | One semantic palette and shared glass recipes | Avoid disconnected dark and light controls |
| High | Canvas editors | Native controls contain hardcoded white text and black fills | Theme-aware window chrome, editors, menus and safety dialogs | Light mode must remain readable throughout |
| Medium | Assistant | Compact generic form and dense controls | Rounded floating conversation with distinct header, transcript and input | Clear entry, conversation and dismissal |
| Medium | Artifact headers | Mixed treatment and action emphasis | Consistent title, type, primary action and overflow | Predictable interaction across six artifact types |
| Medium | Recovery and first-use hint | Hint z-index above recovery | Hint below modal layer | Preserve priority of recovery decisions |
| Low | Appearance initialization | Saved preference applies after hydration | Apply preference before first paint | Avoid wrong-theme flash |

## Tokens

| Role | Light | Dark |
| --- | --- | --- |
| Workspace | #edf0f5 | #050506 |
| Reading surface | #fcfcfe | #0b0c0e |
| Primary text | #202631 | #f2f2f5 |
| Secondary text | #566171 | #a9abb3 |
| Accent | #354fc4 | #b6c3ff |
| Primary button | #405bd3 / white | #c1cbff / #1c254e |

System sans serif for controls and reading, existing monospace for code. Responsive display type, body at 1rem, utility labels generally .8125–.875rem. Touch controls 44px. Rounded frames have nested inset radii. No idle glow animation; state changes use short interruptible transitions. Reduced motion and transparency have fallbacks.

Regular layout: navigation → introduction and creation / workspace overview → authored examples. Compact layout: navigation → concise introduction → primary action / draft → overview and examples in one scrollable column. Returning users retain real workspace priority.

Guidance consulted: apple-design `liquid-glass.md` › The two layers and Accessibility states; `dark-mode.md` › Best practices; accessibility, layout, typography, color, materials and desktop/window references. Browser controls use semantic CSS and ARIA rather than native Apple-only conventions. Interface-polish skill: concentric radii, optical alignment, explicit transitions, hit regions, icon consistency, restraint.

## Deliberately rejected

- Glass on every reading surface: it reduces hierarchy and text stability.
- An animated rainbow glow around idle controls: it would compete with canvas content and imply activity.
- Fictional recent work, metrics, accounts or attachment controls: actions and state must be real.
- Global recoloring of generated apps and slide artwork: appearance affects application controls; authored content keeps its intended palette.

## Verification

Completed locally, with production-browser evidence in `glass-evidence/`.

- `bun run build`: passed. `bun run typecheck`: passed. `bun test`: 470 passed, 0 failed. Source-only `git diff --check -- src`: clean. The existing `.env.example` trailing blank line was left untouched.
- `studio-browser.cjs`: Chromium and WebKit passed actual sample insertion, navigation, draft preservation, history without replay, and responsive Studio/provider layouts at 1440, 1024, 768, 600, 390 and 320px widths.
- `studio-deep-browser.cjs`: both engines passed a 500-shape workspace with a bounded 80-shape overview, no idle Studio animations, 200% text at 390px, modal keyboard containment and unchanged permission defaults. The header now wraps to avoid enlarged-text overflow.
- `studio-safety-browser.cjs`: both engines passed timer Start/Pause/Reset, real Undo/Redo, missing-key setup, no automatic send after saving, an explicit mocked invalid-key request, compact focused editor, overflow-menu keyboard use, unchanged app source across theme changes and blocked-storage fallback. No real provider request was made.
- `windows-browser.cjs`: both engines passed light/dark screenshots of all six native window types, their five supported editing surfaces, keyboard menus and focused editor bounds at 320×568 and 1024×500. External requests were blocked for this suite.
- `chat-browser.cjs`: both engines passed dark/light compact and expanded layouts, reachable input, draft preservation and zero AI requests. Final chat-only recheck also passed after the welcome-layout and stacking correction, including hit-testing above canvas tips and fully visible wrapped short drafts.
- Solid-surface contrast: light primary 14.82:1 / secondary 6.13:1; dark primary 17.51:1 / secondary 8.54:1. These are token calculations, not claims about every possible composited background.

The source-regex geometry test was updated to recognize the two-item welcome starter slice; its touch-target and press-feedback assertions remain intact. Earlier intermediate log failures in this evidence directory include corrected harness selectors/labels and the fixed large-text overflow; the `*-browser-results.json` files and latest `*-browser-run.txt` logs describe completed suites.

Not verified: physical iPad/Pencil/software keyboard behavior, full screen-reader navigation, real provider credentials or billing, and native OS reduced-transparency propagation in Safari. Reduced-motion/browser theme paths and CSS opaque fallbacks are implemented. Generated app bodies and authored slide/code themes retain their own palette; their native window controls adapt to the application theme.

No commit, deployment or publication was performed. Existing working-tree changes were preserved.

## 29 October refinement

User requested near-pure black instead of lighter graphite. Dark workspace is now #050506 and native surfaces #0b0c0e. The canvas remains #14171e. Glass blends rgba(14,15,18,.87) to rgba(3,4,6,.78), with fine highlights. Chat header/footer no longer create gray bands; assistant replies are unboxed, and the input uses a recessed pill. Light mode remains independently styled. The prompt field grows with text wrapping up to 150px, then scrolls internally.
