# DevHarness bounded v0 walkthrough

This walkthrough describes the current bounded v0 flow for a single goal run.

1. Start with a goal and a repository snapshot.

   The runtime first records the goal, the repository identity, the current head SHA, and the exact
   trust boundary for the run. Nothing mutates the consumer repo at this stage.

2. Let DevHarness understand the repository before it executes anything.

   The runtime produces a compact Alignment Brief that summarizes:

   - the outcome it believes it is targeting;
   - what it understands about the repository;
   - what boundaries and non-goals it will respect;
   - what criteria still need proof or approval;
   - what questions still block forward motion.

3. Review the brief instead of reading every raw artifact.

   The developer review page compresses the run into a small number of visible summaries and
   evidence-backed sections. This is the main trust surface for the human reviewer.

4. Approve only the exact bounded authority needed next.

   When the brief is still blocked, DevHarness asks for explicit clarification or capability
   approval. The approval surface is exact and scoped: it does not grant a broad trust increase and
   it does not approve delivery by itself.

5. Let the runtime plan and split work.

   After the understanding checkpoint is accepted, DevHarness builds a plan, identifies the checks
   it needs, and forms a bounded team layout for implementation and verification.

6. Verify with real evidence.

   DevHarness does not treat a passing function call or a green unit suite as complete proof on its
   own. It expects the strongest available evidence for the project surface: browser or simulator
   checks, database checks, service checks, and any deployment or automation checks that the goal
   depends on.

   In practice, this means the runtime should be able to produce a real-browser smoke result for the
   review surface itself. A healthy run is not just "the page exists"; it should show the expected
   review brief in a real browser, keep the page interactive, and surface the remaining blockers
   clearly. The current review UI already does this for the sample brief: it renders the blocked
   state, proof coverage, autonomy readiness, and blocker list in the browser, and it stays free of
   immediate console errors during the smoke pass. The next step is to connect that same surface to a
   live goal run instead of sample data.

   When the launch services and verification bindings are declared explicitly, the same surface
   should move from "blocked" to "review required" with full structural coverage. That is the
   point where a human can inspect the exact execution surfaces before accepting the declaration.
   When the repository already contains a Playwright base URL, the default proposal now uses that
   loopback target to auto-bind the likely launch service and the browser verification, so the
   reviewer starts from a nearly complete declaration instead of an empty harness.

7. Review the result before delivery.

   The result becomes a Delivery Brief and evidence-backed review surface. The developer can inspect
   what changed, what proved out, and what remains blocked or excluded.

What v0 explicitly does not do:

- auto-merge;
- auto-deploy;
- cross the consumer-repository boundary;
- treat a model's self-report as sufficient proof;
- rely on one test type for every project surface.

The v0 promise is narrower and more useful:

> A goal in, a bounded, reviewable, evidence-backed outcome out.
