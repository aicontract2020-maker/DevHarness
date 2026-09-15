# Technical Plan: Execution Graph Surface

## Spec reference

Implements: `specs/execution-graph-surface/spec.md`

## Approach

1. Add a compact execution-graph summary to the existing onboarding plan model so the current
   execution plan can be read as a next-task queue rather than a raw node list.
2. Extend the live-alignment analysis packet to include an `Execution graph` section with the summary,
   next ready wave, per-node dependencies, resource claims, and blocked reasons when the graph is
   invalid.
3. Surface the same compact execution-graph summary in CLI text output so a developer can see the
   next ready work from the terminal as well as the review page.
4. Keep the review UI generic so the new section appears without adding another bespoke surface.
5. Add focused tests that prove the graph summary is present, honest when blocked, and does not
   mutate the consumer repository.

## AC coverage

| AC | Components |
|----|------------|
| AC-1 | Existing scheduling policy and its tests |
| AC-2 | Onboarding summary, CLI output, live-alignment packet |
| AC-3 | Live-alignment packet and review UI |
| AC-4 | Onboarding summary, CLI output, live-alignment packet |
| AC-5 | Review UI rendering path |
| AC-6 | CLI / packet read path and repository isolation tests |

## Data and contracts

- No new public schema is required for this slice; the execution graph is exposed as a derived
  summary within the existing onboarding and alignment artifacts.
- The underlying `execution-plan` contract remains the source of truth for task ids, dependencies,
  resource claims, integration ownership, and critical-path derivation.
- The new summary remains revision-bound and externally stored with the rest of the goal artifacts.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| The summary looks like execution, not planning | High | Keep language explicitly next-task / review surface, never “running” or “dispatching” |
| Blocked graphs accidentally imply readiness | High | Show blocked reasons first and withhold next-task language when invalid |
| The graph becomes too verbose to review | Medium | One summary item plus per-node items; cap to current execution-plan limits |
| CLI and review UI drift apart | Medium | Reuse the same derived execution-graph summary in both surfaces |

## No migration

Existing goal runs remain readable. This slice only changes what the current plan and live alignment
surfaces show; it does not rewrite stored runs or change the consumer repository layout.
