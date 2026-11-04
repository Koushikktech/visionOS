# Headless WebKit verification — 26 Oct 2026

This is local browser evidence from Playwright WebKit 26.5 (Safari-like engine) on macOS 27.0.1 arm64. Initial checks used the local development server at `http://127.0.0.1:3006`; final WebKit production checks used `http://127.0.0.1:3005` in fresh headless Playwright contexts. Chromium production checks also used port 3005. This does not verify the Safari app, a physical iPad, Pencil input, VoiceOver, or deployment behavior.

## Onboarding focus fix

Before the fix, WebKit moved Tab from the onboarding step heading to the Pages control behind the modal. On a 320×568 viewport, the “Connect Gemini AI” button initially sat below the visible portion of its scroll area at y=676; WebKit skipped it in native Tab order. The same page in Chromium focused it normally.

`useDialogFocus` now captures Tab before child handlers and advances through the dialog’s focusable elements itself. In WebKit and Chromium, the regression flow passed: initial heading focus, Tab stays in the dialog, the clipped button receives focus and scrolls into view (scrollTop 190; button y≈487–531), forward and reverse boundary wrapping, Enter activation, step changes, and Escape dismissal with the onboarding preference persisted. The 320px Pages flow also passed create, select (`aria-current="page"`), rename, viewport bounds, Escape, and focus return.

Reproduce with [focus-pages.cjs](focus-pages.cjs). The browser package and browser cache paths can be overridden with `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH`; `VISIONOS_BASE_URL` selects the app server.

## Other checks

- Responsive custom-shape editing: at 320×568, 768×1024, and 1024×768, all five shape types opened one in-bounds editor dialog with no page errors in the final production WebKit run (15/15). The earlier HMR-only `SyntaxError: Unexpected EOF` did not recur. Results: [production matrix JSON](touch-matrix-production-results.json); harness: [touch-matrix.cjs](touch-matrix.cjs).
- Final production onboarding and Pages keyboard regression passed in WebKit: initial focus, Tab containment, clipped control scroll, both wrapping directions, step changes, Escape persistence, and 320px Pages create/select/rename/Escape focus return. See [production focus result](focus-pages-production-results.json).
- Dock popovers: Coral/XL selection, touch taps, Escape/focus return, outside-click dismissal, and viewport clamping passed at 640×400 and 320×568.
- Artifact runtime and storage: imported app stayed paused with zero iframes; Review → Run mounted one opaque iframe. Its initial bridged localStorage read returned 3, an increment persisted 4, and an awaited read of the exact active workspace epoch/generation row confirmed `{count:"4"}` before reload. Reload retained 4. Restricted image/fetch/form paths produced zero intercepted requests; explicit permission enabled the three requests, and editing source revoked permission. Script self-navigation remained allowed.
- Document export: edited content downloaded as Markdown and HTML in WebKit. The HTML metadata title containing `<script>` was escaped.
- Deck export: edited deck downloaded a 49,366-byte PPTX. The file was a valid OOXML ZIP with one slide and notes part; `docProps/core.xml` contained the edited deck title.
- PNG portability: an embedded PNG backup fixture exported with `embeddedAssetCount: 1` and no exclusions, then rendered in a fresh isolated WebKit context (`naturalWidth: 1`). This tests backup portability from an embedded fixture, not native file drag-and-drop in Safari.
- Web Locks: `navigator.locks.request` existed in WebKit and Chromium on localhost. An exclusive lock blocked a same-origin second page’s `ifAvailable` request and became available after release. See [web-locks.cjs](web-locks.cjs).

## Primary-board recovery flow

`board-recovery.cjs` ran against the local development server at `http://127.0.0.1:3006` and final production at `http://127.0.0.1:3005` in fresh, isolated headless WebKit contexts. Each context let the app seed its own `visionos-primary-board-recovery-v1` database, then manually renamed the active page and polled the exact IndexedDB record and metadata transaction until revision 2 acknowledged that document delta. The fixture updated the app-owned active page row to a distinct recovery title and recomputed each record's UTF-8 byte count plus metadata `revision`, `recordCount`, and `bytes`, then announced the revision through the app's normal `BroadcastChannel` path.

The app detected each conflict; Review showed the live and recovery titles; Download produced valid `visionos-backup` JSON with the reviewed recovery title. Recovery-review focus passed: the heading received initial focus, Tab entered the dialog, Shift+Tab wrapped to the last control, and Escape restored focus to the Review trigger. Keep committed the live page at revision 4. Restore committed the recovery page at revision 4 and wrote `visionos-workspace-recovery-v1` / `before-last-restore` containing the live pre-restore page. Instrumentation on WebKit's `LockManager.prototype.request` observed acquisition of `visionos-primarycanvas-recovery-copy` during the app's actual operations, including required restore. A stale-review CAS case changed the owned recovery copy from revision 3 to 4 without a notification while Review was open; Restore rejected it, left the live page unchanged and preserved the newer recovery row/revision, then Review latest showed the changed copy and enabled Restore. All three production scenarios had zero page errors. Results: [development](board-recovery-results.json) and [final production](board-recovery-production-results.json); harness: [board-recovery.cjs](board-recovery.cjs).

Final production downloads also passed in WebKit: Docs Markdown and HTML had edited content, the HTML title was escaped, and PPTX downloaded as a 49,366-byte OOXML archive. An embedded 1×1 PNG fixture exported with one asset and no exclusions, then imported and rendered in a fresh context. Evidence: [Docs](doc-export-production.txt), [PPTX download](deck-export-production.txt), [OOXML listing](deck-ooxml-listing-production.txt), [PNG portability](png-portability-production.txt).

This is headless WebKit 26.5 engine evidence, not a Safari app or physical-device test. The controlled conflict was intentionally created by changing a valid record in the app-owned IndexedDB fixture; no other browser profile or external service was used.

The final production network probe used only a synthetic `.invalid` domain intercepted by Playwright; it contacted no external provider. Restricted image/fetch/form requests were blocked, a user grant allowed the three intercepted requests, and a source edit revoked the grant. Frame self-navigation remained possible. No live AI provider was called. This is headless WebKit 26.5 engine evidence on macOS, not Safari app, physical iPad, Pencil, VoiceOver, or deployed-service verification.

## Final production Chromium results

- Primary-board recovery: **Keep current, Restore recovery, and stale-review rejection** passed, each with zero page errors. Restore preserved the live prior page as **Restore previous** and recorded use of the actual Web Lock. The stale revision 3 → 4 case rejected before loading, kept the live page unchanged, preserved revision 4, then enabled Review latest. See [Chromium recovery results](chromium-recovery-results.json).
- Delayed native synchronization: two tabs first differed after a 350 ms delayed native channel; after the same document arrived, the exact-match reconciliation reported saved without overwriting either copy. See [result log](chromium-delayed-native-sync.txt) and [screenshot](chromium-native-sync.png).
- Recovery storage unavailable: the canvas stayed usable; no beforeunload warning appeared before document edits, a warning appeared after an edit, and a live-document workspace backup downloaded. See [result log](chromium-unavailable.txt) and [screenshot](chromium-unavailable.png).
- Recovery live-region check: MutationObserver found no normal autosave announcement records during actual app-owned IndexedDB document commits in rebuilt production Chromium and WebKit; conflict and storage-error announcements remain enabled, while actual VoiceOver was not tested ([result](recovery-announcements.txt), [harness](recovery-announcements.cjs)).
- Responsive editing: five shape types across 320×568, 768×1024, and 1024×768 passed **15/15** with no page errors. See [results](chromium-touch-results.json).
- Native AI created and mutated a deck using the complete two-slide context; the revised PPTX downloaded. See [result](chromium-ai.txt).

The aggregate suite passed 403 tests across 42 files; typecheck, production build, and `git diff --check` passed. The Oct 26 dependency audit remained at two moderate advisories and no high advisories: [tests](tests.txt), [build](build.txt), [dependency report](dependencies.json).
