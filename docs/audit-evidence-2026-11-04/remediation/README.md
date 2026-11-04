# BYOK release remediation — 4 November 2026

Follow-up to the [latest-code readiness review](../README.md). User authorized fixing the remaining code findings and leaving physical iPad testing and deployment for later. Coding used Luna xhigh agents; the coordinating model reviewed the changes and runs integrated verification. Existing working-tree changes are preserved. No commit, deployment or live billed provider request is part of this work.

## Release scope and availability

OpenAI's [client-ID guidance](https://developers.openai.com/siwc/request-client-id), checked on 4 November, says website Sign in with ChatGPT is offered to selected commercial partners. The separate open-source plan-usage integration has its own registration requirements; this release does not claim that all OAuth integrations are impossible. The app ships the API-key-based Gemini, OpenAI and OpenRouter flows. A future approved OAuth integration can be designed and verified separately.

## Completed changes

- Remove the public fake subscription connection and the unsafe OAuth authorization/callback/token-exchange implementation.
- Remove the old model-list credential-check endpoint and unconditional credit/plan claims.
- Reject legacy `chatgptOAuthToken` payloads and known fabricated subscription-token prefixes before provider work.
- Migrate stored credentials without discarding genuine API keys or resurrecting explicitly deleted keys. Preserve enough legacy metadata to reject stale OAuth tokens when browser writes fail, until every key alias can be sanitized.
- Keep real API-key entry directly visible, preserve storage fallback/removal reporting and unsent AI drafts.
- Update stale source assertions to the current responsive panel contract; verify actual bounds in the browser rather than testing a duplicated sizing implementation.
- Update setup documentation and remove unsupported OAuth environment configuration.

## Verification record

**All scoped local checks pass.** The code findings R1–R4 from the preceding review are remediated. This establishes readiness for the remaining release rehearsal, not a claim that physical devices or a deployed service have been verified.

| Check | Final result |
|---|---|
| `bun test` | **475 passed, 0 failed**, across 51 files |
| `bun run typecheck` | Passed |
| `VISIONOS_BUILD_DIR=.next-release-fix bun run build` | Passed; no OAuth callback, token exchange or key-check endpoint in the route output |
| `git diff --check -- src README.md .env.example` | Passed |
| Production-browser regressions in isolated installed Chrome | All checks passed; [machine-readable results](byok-browser-results.json) |
| API-key setup | Fits 320×568, 768×1024 and 1024×500 |
| Actual AI panel, collapsed and expanded | Fits 320×568, 768×1024, 1024×500 and 1440×900; input remains reachable |
| Mixed legacy migration | OAuth/fake tokens removed; genuine-looking API key preserved in local and session aliases; pasted fake cannot replace it |
| Retired public routes | Both removed API endpoints and callback return 404 |
| Missing-key flow | First draft retained, Save does not send, explicit Send issues one intercepted request |
| Runtime errors in browser regression | Zero uncaught page errors |

The final `tests.txt`, `typecheck.txt`, `build.txt`, `browser-run.txt` and results JSON contain the outcomes. Initial typecheck/build diagnostics are retained separately: stale `.next`/`.next-review` generated types referred to deleted routes, and one test used an assertion signature unsupported by the installed typings. The assertion was corrected and only obsolete generated route references were cleared. One overlapping typecheck/build attempt raced generated-file recreation; the final standalone typecheck ran after the build and passed. Browser measurement initially raced the visible-viewport update after resize; waiting for actual layout readiness made the scoped measurements pass without changing application geometry.

Temporary build output and its generated tsconfig include were removed after the local server stopped. Existing tsconfig changes and other user work remain. Tests and builds did not spend provider quota.

The browser script uses synthetic credentials and intercepts AI requests. It tests mixed legacy credentials, preservation of a genuine-looking key, rejected fake input, visible key setup, explicit send, missing-key setup, no automatic send, retired route 404s, and actual compact/default/expanded panel bounds. Provider acceptance, model access and billing are not established by synthetic tests.

The dependency versions were unchanged. The one moderate Tiptap registry advisory retains its [previously verified backport disposition](../README.md#dependency-advisory-disposition); no dependency upgrade or clean reinstall was performed here.

## Deferred verification

Physical iPad Safari/Pencil/software keyboard and assistive navigation remain for device testing. Deployment and real-provider smoke checks on the deployed HTTPS origin remain for the release rehearsal. Generated-app networking retains the previously documented browser-policy limits; these credential changes do not establish strict network containment.
