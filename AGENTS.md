# DevHarness agent instructions

## Mission

Build a portable, open-source autonomous engineering runtime that turns approved software goals into evidence-backed pull requests across different repositories and coding agents.

## Repository boundary

- This repository owns framework code, contracts, adapters, packs, templates, and framework tests.
- Consumer repositories are external. Never add DevHarness framework source to a consumer.
- Do not hardcode `AIedu_demo`, its paths, users, ports, commands, features, or stack into core packages.
- Consumer-specific behavior belongs in a declarative project configuration or a generated project harness.
- Runtime state, worktrees, generated agent files, and evidence must be stored outside consumer repositories by default.
- Local sibling paths may be used only as explicit development inputs and must never become portable configuration defaults.

## Product invariants

- Agent self-report is not verification evidence.
- Completion requires criterion-level verdicts backed by reproducible evidence.
- Behavior-critical implementation and final verification must be independently evaluated.
- Unsupported or unverifiable work ends as `blocked` or `failed`, never as a false success.
- Goal runs are durable and resumable from events and artifacts rather than chat history.
- Private model chain-of-thought is not a product artifact. Record decisions, assumptions, sources, and evidence instead.
- Default human gates are scope approval and delivery approval.
- Detailed artifacts are runtime memory and audit evidence, not a developer inbox; default interaction uses bounded traceable briefs and review by exception.
- Destructive or externally consequential actions require explicit policy and authority.

## Architecture discipline

- Keep core contracts agent-agnostic and platform-agnostic.
- Isolate agent-specific behavior behind adapters.
- Isolate reusable proof mechanisms behind platform packs.
- Prove an interface with at least two implementations before declaring it stable when practical.
- Build readiness and reliable verification before optimizing multi-agent scheduling.
- Give repair loops explicit attempt, time, cost, and scope budgets.
- Prefer structured, versioned artifacts over prose-only handoffs.

## Development sequence

Until the architecture contracts are approved, prioritize documentation, schemas, fixtures, and deterministic contract tests. Do not build a hosted control plane, automatic merge, or broad platform support in v0.

The first external dogfood consumer is `AIedu_demo`. A structurally different CLI or API consumer must be added before core interfaces are considered portable.
