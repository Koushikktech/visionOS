# visionOS redesign handoff

The subsequent liquid-glass and near-black refinements (28–29 October) are documented in [GLASS_REDESIGN.md](GLASS_REDESIGN.md), with current browser evidence in [glass-evidence/](glass-evidence/). That record supersedes the earlier visual direction and incomplete-verification status below.

Design date: 28 October 2026. Status: implemented locally; final browser verification is incomplete at the allowance guard, with details recorded in [IMPLEMENTATION_RECORD.md](IMPLEMENTATION_RECORD.md). The original design boards below remain composition studies; actual browser evidence is in [evidence/](evidence/). No commit, deployment or publication was performed.

Read [DESIGN_SPEC.md](DESIGN_SPEC.md) first, then [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). The visual boards illustrate composition, hierarchy, material and content; the written specification controls behavior, accessibility, responsive sizing and truthful state. Example content in the boards is fictional and must never be presented as a user's existing work.

## Visual direction boards

- [Returning-user Studio](studio-direction.png): spatial overview, primary continuation action, compact draft entry and authored examples.
- [First visit, iPad and AI setup](first-use-and-setup.png): sample-led introduction and contextual provider connection.

These are static composition studies, not final component screenshots or interactive prototypes. The written specification includes light appearance, narrow reflow, errors and motion that cannot be demonstrated in these boards. Replace illustrative arrow glyphs with the existing Lucide icons during implementation. Do not copy illustrative metadata, descriptive summaries or storage claims into real workspace UI unless supported by actual state.

## Direction

**A studio you enter through your work.** The entrance presents a spatial overview of the actual canvas. Entering brings that same arrangement into working scale. The product earns its identity through the relationship between sketches, documents, slides and working apps, with precise controls and a restrained glass navigation layer.

The dashboard becomes **Studio**. This is the workspace entrance for the testing release, not a marketing homepage or an account dashboard. Existing work is primary; an optional sample teaches the product through use. Credentials, recovery and technical information remain accessible without dominating the composition.

## Continuation prompt

> Implement the redesign specified in docs/redesign/DESIGN_SPEC.md and docs/redesign/IMPLEMENTATION_PLAN.md. Read applicable AGENTS.md instructions and inspect the dirty worktree first. Preserve all existing user changes and working engine, persistence, recovery, export and sandbox behavior. Follow the phase gates; do not reinterpret the plan as a generic dashboard or expand into accounts, cloud sync, billing, multi-workspace storage or Swarm. The user previously requested Luna xhigh subagents for product coding, with the coordinating model reviewing and verifying; honor that unless the user changes the instruction. Verify currently available model names before delegation. Monitor the Codex five-hour allowance and stop cleanly before remaining allowance falls below 5%. Finish the active safe phase and record completed work, evidence and remaining work in this folder. Do not commit, deploy or publish unless requested. Do not describe static mockups as tested browser behavior.

## Evidence boundary

Reviewed dashboard/onboarding/page routing source, canvas startup and persisted-workspace integration, provider settings entry points, shared style tokens, global surface rules, recovery summary and state contracts, permissions dialog structure, current feature roadmap, README and existing editor screenshot evidence. This was a design review, not a new full correctness audit. No live-browser interaction or motion playback was performed. Screenshots in older audit folders do not establish the current dashboard's runtime appearance. No new build or tests were run because this phase changes only documents and design artifacts.

The historical roadmap is explicitly marked non-authoritative for release verification. The current checkout also contains newer dashboard and provider UI than some previous audit evidence; do not assume those changes inherited earlier test results.
