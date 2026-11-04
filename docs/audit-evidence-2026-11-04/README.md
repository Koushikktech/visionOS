# Latest-code release readiness review — 4 November 2026

> **Follow-up:** R1–R4 below were subsequently fixed in the local checkout, with 475 passing tests, typecheck/build success and production-browser regression evidence. See the [completed remediation record](remediation/README.md). The findings below describe the pre-fix review. Physical iPad and deployment/live-provider verification remain deferred.

**Verdict: do not release the current checkout unchanged.** Scope is the invited-tester deployment with user-provided provider credentials, not a future server-funded SaaS. Swarm remains out of scope. No product fixes were implemented during this review.

The working directory contains substantial tracked and untracked implementation work beyond HEAD (`c7ba4e5`). This review inspected that working directory, not just committed code. Earlier Oct 27/29 pass counts are historical and do not establish the state of the newer OAuth/provider changes.

## Fresh verification

| Check | Result |
|---|---|
| `bun run typecheck` | Passed |
| `VISIONOS_BUILD_DIR=.next-release-audit bun run build` | Passed; all ten routes generated/compiled |
| `bun test` | **468 passed, 2 failed**, 470 tests across 51 files |
| `bun audit --json` | One moderate advisory, zero high/critical reported; installed Tiptap fix verified separately |
| Local production server | Started successfully on localhost after sandbox permission escalation |
| Isolated installed Chrome, production build | Studio without forced onboarding, sample opens canvas, return suspends app frames; provider dialog bounds pass at 320×568, 768×1024 and 1024×500 |
| Authentication reproductions | Fabricated test token persisted from public setup; mismatched callback state still triggers exchange and accepts mocked success |
| Asset-enabled sample browser check | Canvas mounted; zero uncaught page errors and zero failed requests in the observed interval |

Evidence: `build.txt`, `test-summary.txt`, `dependency-audit.json`, `smoke-results.json`, `asset-smoke-results.json`, the browser scripts, and screenshots in this directory. The initial broad smoke check deliberately blocked every nonlocal request and produced fetch/image-decode errors. That restricted fixture is not a clean-console pass. A separate asset-enabled check passed; neither establishes complete offline resilience. No real provider keys, token exchange or billed inference were used.

The isolated build caused Next to append its temporary type-output path to tsconfig. Only that generated addition was removed afterward. Existing user configuration changes were preserved. Temporary build output was removed after the server stopped.

## Findings requiring action

### R1 — P1: public fake subscription connection breaks real AI setup

Locations: `src/components/ProviderSetup.tsx:329`, `src/lib/ai/chatgptOAuth.ts:298`, and `src/components/VisionOnboardingModal.tsx`.

The public 'Connect test Plus subscription' action calls `simulateTestChatGPTConnection()`. This creates a random `chatgpt_sub_...` string, marks the account connected with active subscription quota, persists the string into provider key storage, and selects OpenAI. The credential verifier also treats that prefix as instantly valid. There is no production/development gate around the public action. The production browser reproduction confirmed the fabricated connected state and `openai` provider preference.

Real chat requests use that stored string as the Bearer credential at `https://api.openai.com/v1/chat/completions`; it is not a provider-issued token. This does not grant access to OpenAI; it creates a false connected state and makes the selected provider fail. It can also replace an existing stored OpenAI credential through `saveChatGPTAccount()`.

Required: remove this simulation from the shipped credential path. Keep mocks in isolated test fixtures. For the agreed test release, ordinary BYOK setup is sufficient. Do not tell testers a fabricated account has subscription allowance.

### R2 — P1: OAuth callback fails open and identity is not verified

Locations: `src/app/auth/openai/callback/page.tsx:38`, `src/app/api/auth/openai/token/route.ts:77`, `src/lib/ai/chatgptOAuth.ts:123` and `:218`.

The callback only warns when state differs and proceeds to exchange. Missing state is accepted; missing verifier becomes a fixed fallback string. There is no transaction expiry or one-time consumption check. The server base64-decodes the ID token and trusts email/name without signature, issuer, audience, expiration or original-nonce verification. The nonce generated during authorization is not retained for comparison. Token responses are reported successful without requiring a nonempty access token or verifying granted plan-use scopes. A hard-coded Plus/Pro plan string substitutes for actual entitlement evidence.

Browser reproduction: with `expected-state` stored and `wrong-state` returned, the callback made one exchange request and persisted `connected: true` when the local test interceptor supplied a mock success. This proves the callback's validation defect; it does not claim a complete real-provider account-takeover exploit or a failure of OpenAI's PKCE validation.

Required: disable this flow for the BYOK release, or implement a bound, expiring, single-use authorization transaction; reject every invalid/missing/reused state/verifier; validate OIDC identity and required grants; clear transient state; require real tokens. Current [OpenAI website guidance](https://developers.openai.com/siwc/website) explicitly requires failing closed on invalid transactions and validating identity claims. Current [plan-use integration guidance](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt?site_locale=en) supports real ChatGPT plan integration: the problem is this incomplete implementation, not that the feature is categorically impossible.

### R3 — P2: connection lifecycle and credit claims remain incomplete

Locations: `src/lib/ai/chatgptOAuth.ts:218`, `src/app/api/auth/openai/token/route.ts:103`, `src/app/api/ai/openai-check/route.ts:68`.

The exchange returns `expiresIn`, but the saved account discards it. Refresh tokens are stored but no refresh lifecycle is implemented in the inspected OAuth flow. The UI therefore has no reliable way to distinguish a still-connected account from an expired token. The OpenAI key-check route returns `hasCredits: true` after listing models; successful model listing does not establish inference billing or remaining credit. Connected, key accepted, inference authorized and quota available need separate truthful states.

Required if OAuth remains enabled: implement expiry/refresh/reconnection and actual grant/model discovery behavior; prove one real inference with the configured integration. Remove unconditional credit/plan claims. Do not treat success badges as evidence that subscription routing works.

### R4 — P2: release test suite is red

Locations: `src/test/geometrySizingChallenge.test.ts:51`, `src/test/adversarial_geometry_constraints.test.ts:522`.

Both failures expect the literal source fragment `Math.min(600, availablePanelWidth)`. The current panel computes compact/expanded widths of 520/680/480 with available-width clamping. The observed failures are stale source-string assertions, not evidence that those browser layouts are broken. The scoped provider-dialog browser size checks passed. Reconcile the tests with the approved layout contract and prefer meaningful bounded-layout coverage; do not merely restore the obsolete literal to appease a test. Ship with a passing, relevant suite.

## Dependency advisory disposition

Registry: [GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh), Tiptap `mergeAttributes()` prototype manipulation and executable inherited DOM attributes.

The installed and pinned `@tiptap/core` is **2.27.3**. Both `src/utilities/mergeAttributes.ts` and `dist/index.cjs` contain the `__proto__` own-data-property backport. A direct check against the installed helper with an own JSON `__proto__` key returned an object with an unchanged prototype, no inherited `onerror`, and an own `__proto__` property. The [upstream issue](https://github.com/ueberdosis/tiptap/issues/8339) documents the missing v2 patched-version metadata. This audit treats the remaining record as triaged metadata mismatch for this installation, not a demonstrated unpatched application vulnerability. Keep the pin and verification; do not make an untested major upgrade solely to silence the scanner. No frozen clean reinstall was performed in this review.

## Verification still required before a readiness claim

- Real deployed HTTPS origin: BYOK request routing, streaming/cancellation/timeouts, environment-key exclusion, log redaction and backup/restore. Automated production-key exclusion tests passed locally; deployment behavior was not observed.
- Real provider credentials and model compatibility for each advertised provider. No billed requests were issued in this review. If ChatGPT sign-in is advertised, complete the official integration and a real authorization/inference exercise.
- Physical iPad Safari: finger/Pencil, keyboard, Split View, iframe interaction escape and assistive navigation. Chromium viewport checks are not device certification. Fresh WebKit was unavailable in the local cached test runtimes.
- Updated release evidence for new provider/authorization changes. The Oct 29 document says there were no OAuth/credit claims then; today's source contains them and cannot inherit that sign-off.
- Generated-app networking remains a browser sandbox plus permission policy with known best-effort peer-connection limits in WebKit. Do not advertise strict arbitrary-code network containment. No new adversarial WebKit test was run here.

## Smallest sensible release path

1. Ship the working BYOK provider forms, removing/gating fake credentials and incomplete OAuth paths from the deployed app and public routes.
2. Remove unsupported credit/plan claims; get the relevant tests green.
3. Run deployed live-key smoke checks and the physical iPad core workflow checklist.
4. Keep accounts, server-funded allowances and Swarm outside this invited-tester release, as previously agreed.

The redesign itself is implemented in the latest source and its central Studio/sample flow passed this limited fresh browser check. The release blockers are concrete; this is not a recommendation to restart the design or add SaaS infrastructure before testing.
