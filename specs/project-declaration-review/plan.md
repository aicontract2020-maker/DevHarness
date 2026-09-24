# Technical Plan: Project Declaration Review

1. Add a pure project-declaration assessor backed by the compiled harness.
2. Treat service-free interactive verification as a harness blocker and execution-plan error.
3. Add a token-protected read-only declaration route to the existing review service.
4. Render its bounded assessment above capability requests on the review page.
5. Validate with unit, API, UI and real example-consumer read-only checks.

| AC | Components |
|---|---|
| AC-1 | project declaration assessor |
| AC-2 | harness compiler and verification planner |
| AC-3 | review service and client |
| AC-4 | review page |
| AC-5 | example-consumer dogfood |

No new mutable API is introduced. The review service receives the already captured repository
snapshot, so every assessment is bound to the same revision shown to the developer.

