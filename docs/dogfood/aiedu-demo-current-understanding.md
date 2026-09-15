# AIedu demo · current understanding snapshot

- Date: 2026-09-03
- Repo under study: `AIedu_demo`
- Goal run: `run-7b3fd1fe-ad78-4d84-ad83-9995c50d3ec5`
- Base revision: `7f32844e6d4e3bb721191f41479f01c57dbc51ac`
- Working copy used for analysis: `/private/tmp/aiedu-clean`

## What DevHarness has confirmed

- The repository is a Git project with a clean committed baseline in the analysis copy.
- The project has the expected web + API surface.
- The project already exposes build, test, launch, and browser-verification commands.
- A project declaration exists and is valid.
- Local environment examples exist, so required keys are discoverable without leaking secret values.
- The database submodule is expected and part of the project shape.

## What the current run has already proved

- The goal has been accepted and tracked as a durable run.
- A Supervisor approval path works for:
  - agent runtime
  - browser runtime
  - database runtime
  - service runtime
  - dependency install
  - container runtime
  - credential references
  - five research tasks
- The runtime can produce a concise Alignment Brief instead of dumping every file.
- The runtime can surface a staged preflight sequence:
  - clarify
  - research
  - split into crews
  - verify
  - review
  - deliver

## What the system still thinks is missing

- Falsifiable acceptance criteria and non-goals still need to be tightened.
- The initial understanding is still incomplete for:
  - database
  - security
  - strategy
  - runtime
- Test and verification evidence still needs to move from “detected” to “proven”.
- Delivery traceability and independent review are still not closed.

## Current blockers

1. Current review missing.
2. Scope not approved *(historical for `run-7b3fd1fe…`; dogfood `run-a4118507…` now has `gates.scope.status=approved` after the DevHarness approve→gate fix / status reconcile)*.
3. Trusted delivery context missing.
4. Trusted review evidence missing.
5. Acceptance criteria not defined.
6. Database understanding not yet proved.
7. Runtime understanding not yet proved.
8. Security understanding not yet proved.
9. Strategy understanding not yet proved.
10. Testing understanding is only detected, not yet proven.

## What we learned about the target project

The project is already close to being a good DevHarness candidate because it has:

- real backend and frontend surfaces,
- database work,
- long-running service startup,
- browser-visible behavior,
- and enough test/deploy structure to support a full autonomous-development loop.

But it is not yet a fully trusted autonomous target because the system has not yet:

- proved the project’s understanding chain end to end,
- bound a reviewable acceptance contract,
- and collected real-surface evidence for the most important flows.

## Next step

Continue the clarifying run until the remaining understanding gaps are resolved, then move into executable understanding and behavior proof.
