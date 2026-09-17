# Existing-project engagement: three phases

> Canonical methodology for how DevHarness takes on an **existing** (brownfield) repository.
> Greenfield projects still use Goal Runs and the two human gates, but they do not need a
> separate "understand legacy + harden baseline" arc before feature work.
>
> Last updated: 2026-09-13

## Product role (reminder)

DevHarness is a **goal-oriented engineering runtime for coding agents**. Its job is not only
to configure an environment or run one smoke test. It must be able to:

- understand a codebase well enough to act safely;
- write code for new behavior;
- review and verify with revision-bound evidence;
- fix bugs it finds or introduces;

and finish in an honest outcome (evidence-backed delivery, explicit blocker, or failed
verdict) — never "the model said it was done."

Environment setup and capability approvals are **prerequisites inside early onboarding**.
They are not a substitute for understanding the project or for hardening it.

## The three phases (order is mandatory)

When DevHarness engages an existing project, work proceeds in three phases. **Do not skip
ahead.** Feature goals (phase 3) are out of order until phases 1 and 2 are real.

```text
Phase 1  Understand the project
    ↓
Phase 2  Test thoroughly and fix bugs (stabilize the baseline)
    ↓
Phase 3  Autonomously develop new features from goals
```

### Phase 1 — Understand

**Purpose:** make the repository known enough that later autonomous work is not guessing.

**Includes:**

- Product goals and non-goals (what the system is for).
- Tech stack, frameworks, runtime, data stores, auth.
- Architecture: major modules, routes/domains, ownership boundaries.
- Config / local-run contract (how a clean machine boots the system).
- Test map: what scripts and suites exist, what they actually cover.
- Environment setup and **bounded capability approvals** (install, service, browser, DB, …).

**Does not mean:** "doctor is green" or "one Cypress job passed" alone. Those are useful
signals. Thorough understanding still needs a revision-bound understanding brief (claims,
gaps, conflicts) across the real domains of the app.

**Exit when:** a compact, auditable understanding of goals / stack / modules / test map
exists; critical unknowns are listed; required capabilities for phase 2 are approved or
explicitly blocked.

### Phase 2 — Test and fix bugs

**Purpose:** prove and stabilize existing behavior before adding surface area.

**Includes:**

- Run the project's own verification ladder in a sensible order (startup → targeted unit →
  broader system / browser suites), not only the happiest smoke path.
- Triage failures into fixture/contract, environment, and real product bugs.
- Fix real bugs with evidence; re-verify on the same revision rules DevHarness already uses.
- Expand coverage only where phase 1 marked dangerous gaps — still baseline hardening, not
  feature invention.

**Does not mean:** opening feature PRs, redesigning product scope, or treating a single
attested smoke receipt as "the project is healthy."

**Exit when:** agreed baseline suites are green (or failures are classified with owners);
known severity bugs from that pass are fixed or explicitly deferred; the baseline is safe
enough that feature work will not be debugging unknown rot.

### Phase 3 — Goal-driven feature development

**Purpose:** only now accept product goals that add or change behavior.

**Includes:**

- Gate 1 alignment (scope, design, falsifiable acceptance).
- Implement / review / verify / repair under DevHarness autonomy policy.
- Gate 2 delivery with revision-bound evidence.

**Blocked when:** phase 1 understanding is thin, or phase 2 baseline is still red / unknown.

## How this maps to current commands (v0)

| Phase | Typical DevHarness surfaces (today) |
|---|---|
| 1 | `doctor`, `onboard`, `build`, external project harness, Alignment / capability TTY, understanding brief |
| 2 | `verify --execute --attest` and project test commands; bugfix under a Goal Run aimed at **baseline health**, not new features |
| 3 | Goal Run whose acceptance criteria describe **new** user-visible behavior; Gates 1 and 2 |

v0 progress: Phase 1 can now reach understanding-ready (auditable baseline + complete model + approved strategy + live evidence). Phase 2 still requires attesting the configured quality ladder (`doctor` prints the Phase 2 command ladder). CLI live alignment does not fully replace human-led depth for hard conflicts. The **methodology still
holds** — implementers and operators must not jump to phase 3 because a smoke verify passed.


## When the consumer cannot be patched

Phase 2 sometimes finds **test-order or missing-seed coupling** (a suite assumes data
another suite created). Ideal fix is consumer-side self-sufficient seeds. When policy is
**harness-only** (do not modify the consumer):

1. Keep using the consumer’s full verify command when it already encodes a safe order.
2. Otherwise declare a **DevHarness-owned verification recipe** in the external project
   config (ordered `--spec` lists, harness-owned seed scripts under `local-projects/`, or
   documented Phase-2 runbooks) — never invent an ad-hoc folder order in chat.
3. Treat failures only under an unsafe order as recipe bugs, not product bugs, until they
   reproduce under the declared safe recipe.

Dogfood example: [sunrise-cms-verification-recipe.md](./dogfood/sunrise-cms-verification-recipe.md).

## Anti-patterns

- Treating harness wiring + one Cypress pass as "ready for autonomous features."
- Running `npm test` (or equivalent kitchen-sink) as the only phase 2 plan when it hides
  nested browser suites or environment coupling.
- Asking for blank-check credentials instead of bounded capabilities tied to a recipe.
- Starting feature goals while database / auth / critical user flows remain `unknown`.
- Declaring a consumer folder “red” after running it in an order that skips required seeds, then patching the consumer when a harness-owned recipe would suffice.

## Related docs

- [Executable onboarding and repository understanding](./onboarding-and-understanding.md)
- [Product definition](./product.md)
- [Principles (中文)](./devharness-principles-zh.md) — section on 三步上手
- [Verification receipts](./verification-receipts.md)
- [Supervisor provenance](./supervisor-provenance.md)
