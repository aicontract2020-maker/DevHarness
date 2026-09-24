# Project Declaration Review

Status: Implemented and validated
Version: 1.0
Mode: Full
Last updated: 2026-08-31

## Overview

Turn a generated project declaration into a compact, quantitative decision surface so a developer
can judge what DevHarness understands without reading every detected command.

## Boundaries

**Always do:** bind the assessment to repository identity and revision; distinguish structural
coverage from runtime proof; show every approval blocker and the smallest developer decision.

**Never do:** claim a detected command works; approve a declaration through the read-only page;
execute a verification whose required interactive service is unbound.

## Acceptance criteria

### AC-1: Quantitative declaration assessment [MUST]

Given a generated declaration, when it is assessed, then DevHarness reports deterministic structural
coverage, mapped/unmapped lifecycle counts and a blocking verdict.

### AC-2: Interactive verification is fail-closed [MUST]

Given a web, mobile or desktop verification with no service, when the harness is compiled or a run is
prepared, then it is blocking and no consumer process starts.

### AC-3: Compact review endpoint [MUST]

Given the local review service, when the authenticated page requests the project declaration, then it
receives a read-only revision-bound assessment with no environment values.

### AC-4: One-screen developer review [MUST]

Given an incomplete declaration, when the developer opens the review page, then they see the score,
mapped counts, top blockers and one precise next decision without opening generated files.

### AC-5: Consumer remains unchanged [MUST]

Given example-consumer dogfood, when the declaration is assessed, then no file is written and no project
command is executed.

## Out of scope

- Approving or writing `devharness.yaml` from the browser.
- Inferring that the example-consumer Docker recipe is safe without developer confirmation.
- Starting containers, services, browsers or databases.
