# Research: Project Declaration Review

## Current DevHarness behavior

- The generator copies every detected command, creates no service lifecycle, and binds every verify command to an empty service list (`packages/project/src/init.mjs:15`, `packages/project/src/init.mjs:23`, `packages/project/src/init.mjs:26`).
- Harness compilation already detects launch commands without readiness/teardown declarations, but it does not reject interactive verification with no service (`packages/project/src/harness.mjs:71`, `packages/project/src/harness.mjs:86`, `packages/project/src/harness.mjs:99`).
- The read-only review API exposes run, interaction and capability data, but no project-declaration assessment (`packages/runtime/src/review-server.mjs:64`, `packages/runtime/src/review-server.mjs:77`, `packages/runtime/src/review-server.mjs:87`).
- The review page already compresses runtime artifacts and capability decisions into one screen (`apps/review-ui/app/page.tsx:137`, `apps/review-ui/app/page.tsx:172`).

## example-consumer evidence

- The base Compose file explicitly says the app services require the development overlay and gives the two-file launch recipe (`../example-consumer/docker-compose.yml:1`, `../example-consumer/docker-compose.yml:6`).
- The development overlay defines backend and frontend, depends on healthy Postgres/Redis, and exposes frontend port 3000 (`../example-consumer/docker-compose.dev.yml:11`, `../example-consumer/docker-compose.dev.yml:38`, `../example-consumer/docker-compose.dev.yml:46`, `../example-consumer/docker-compose.dev.yml:54`).
- Playwright targets `http://localhost:3000` by default (`../example-consumer/frontend/playwright.config.ts:3`, `../example-consumer/frontend/playwright.config.ts:15`).

## Findings

1. [CONFIRMED] The current proposal is structurally incomplete, not merely unapproved.
2. [CONFIRMED] A numeric structural-coverage result can be derived without executing consumer code.
3. [CONFIRMED] example-consumer needs one developer decision about the owned full-stack recipe before execution can be trusted.
4. [VERIFY] The two-file Docker recipe is the intended autonomous test runtime; repository evidence supports it, but a developer must confirm its authority and isolation policy.

