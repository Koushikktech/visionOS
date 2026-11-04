# Local production verification — 27 October 2026

All browser checks used the rebuilt Next production app at `http://127.0.0.1:3005` in fresh isolated Playwright Chromium and WebKit contexts. The harnesses use the cached Playwright module path shown in their source; adjust it and `PLAYWRIGHT_BROWSERS_PATH` on another machine. Synthetic AI responses and dummy keys were used; no live provider or real microphone was contacted. This verifies the exercised local cases, not Safari the app, a physical iPad, Pencil, VoiceOver, deployed infrastructure, or live model quality.

## Combined checks

- **429 tests passed, zero failures, 45 files:** [test log](tests.txt).
- Typecheck and production build passed: [typecheck](typecheck.txt), [build](build.txt). Final `git diff --check` also passed.
- The final dependency audit reports **one moderate** `@tiptap/core` metadata advisory: [raw JSON](dependencies.json). The installed 2.27.3 own-`__proto__` backport remains triaged. A compatible `postcss-selector-parser` 6.1.5 override removed its advisory; frozen-lockfile installation succeeded. An audit exit code of 1 is expected while the metadata advisory remains.

## Real editor correctness and recovery

[Harness](real-editor-correctness.cjs), [results](real-editor-correctness-results.json): in both engines, three content-only app regenerations preserved the exact child local x/y, 360×240 dimensions, rotation, parent ID and rotated frame geometry. Each request carried complete current selected source and intrinsic dimensions. A controlled second-create failure rolled back the entire AI batch, kept the original shapes exact and left the drawing surface usable without the SDK fatal error screen. No page errors occurred.

[Restore harness](real-restore-failure.cjs), [results](real-restore-failure-results.json): an injected live loader applied a valid imported document and then threw once. The real backup pipeline restored the exact prior document inside its transaction, kept the canvas usable, accepted another edit and retained the original plus later edit after reload in both engines. No page errors occurred in the final runs after initial SDK requests settled. The test obtains the mounted editor through React test instrumentation, then exercises public editor methods; this instrumentation is not shipped in product code.

[Worker race harness](worker-draft-race.cjs), [results](worker-draft-race-results.json): the harness delays delivery of the real worker's solved result. Starting a source draft in that interval prevents replacement and preserves the draft. The rejected result triggers an index rebase; a later mutation succeeds. Enabling read-only mode during another solve also prevents mutation. Both engines passed with no page errors.

## Storage, controls and editing

[Key harness](key-storage.cjs), [six results](key-storage-results.json): Chromium and WebKit each exercised persistent, tab-session and memory-only key storage. The canvas stayed usable; dummy keys worked in a mocked request; reload retention matched the advertised scope; removal did not resurrect keys through legacy/session aliases. The memory-only case verifies key loss on reload rather than persistence of a removal. No page errors occurred in final runs.

Responsive editing passed **15/15 cases in each engine**, covering Rich Card, Code Card, Document, Slide Deck and Interactive App at 320×568, 768×1024 and 1024×768: [Chromium](touch-chromium.json), [WebKit](touch-webkit.json). The existing harness is [the Oct 26 matrix](../audit-evidence-2026-10-26/touch-matrix.cjs); switch its browser import for Chromium.

Dock Coral/XL selection, portal bounds, touch interaction and Escape/focus return passed at 320×568 and 640×400 in both engines: [Chromium](dock-chromium.json), [WebKit](dock-webkit.json). The final [visual harness](ui-visual.cjs) also verified End, Home and ArrowDown after initial menu focus at 320px and 768px: [log](ui-visual.txt). The popover's delayed initial focus now yields to existing focus and modal dialogs and is canceled by keyboard input. Screenshots: [compact menu](menu-320.png), [tablet menu](menu-768.png), [compact editor](editor-320.png), [tablet editor](editor-768.png).

## Dictation and clipboard evidence boundary

The [Chromium speech harness](voice-lifecycle-chromium.cjs) uses fake recognizers, deferred media promises and synthetic audio context/track objects: [result](voice-lifecycle-chromium-results.json). Stale callbacks did not restart or stop a replacement mic; permission requests remained single-flight; late streams were released on close or fatal recognition error; dictation inserted at the caret and manual edits survived later results. No page errors occurred. This is app lifecycle simulation, not real speech recognition, microphone permission, audio quality or physical Safari verification. WebKit speech simulation is not claimed as passed in this checkpoint. Its synthetic recognizer start reached the audio-context mock but did not reach the queued media mock; a direct call to that media mock worked. This harness did not establish the lifecycle result or confirm a product bug. The diagnostic is retained [here](voice-webkit-diagnostic.txt).

Clipboard helper tests cover API rejection, fallback false/success, throwing selection cleanup and focus/selection restoration. Dictation insertion helpers have targeted selection/boundary tests. These are included in the aggregate unit log, not a certification of platform clipboard or microphone permissions.

## Known limits and diagnostic corrections

Early reloads canceled SDK CDN font/translation requests and produced headless WebKit `EncodingError` / `Load failed` promise diagnostics: [captured diagnostic](early-reload-resource-cancellation.txt). The exact data and subsequent edits were retained; no data-restoration or fatal-editor failure was found. Awaiting initial network idle removed these diagnostics in final restore/key runs. CDN availability remains a runtime dependency; the final runs do not establish offline behavior or suspension safety.

Test harness corrections included waiting for committed React/UI state, waiting for a removed key control to detach before reload, selecting the Rich Card span rather than a nonexistent heading, and acquiring initial menu focus before keyboard assertions. These are not product fixes or product failures. Browser engine simulation does not replace physical iPad, Safari/Pencil/palm input, soft keyboard, assistive technology or deployment checks. Earlier Chromium probes showed a child self-navigation escape; the current trusted-wrapper boundary stops the tested attempt in Chromium, with WebKit wrapper-navigation review ongoing. This is not a complete network firewall: native peer-to-peer APIs can bypass the runtime's JavaScript guard in nested WebKit previews, so that control is best effort. Swarm was excluded from this phase.
