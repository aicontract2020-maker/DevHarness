# Repository Understanding Digest

Status: Draft
Version: 1.0
Mode: Full
Last updated: 2026-09-01

## Overview

Strengthen the existing onboarding brief so a developer can review repository understanding by exception and by count, not by reading every generated artifact. The new digest keeps the current read-only discovery boundary, but makes the output more legible when a repository contains database, security, testing, or documentation conflicts.

## Boundaries

**Always do:** stay read-only; bind the digest to the current repository identity and revision; summarize understanding with deterministic counts; surface conflicts before general warnings; keep database, security, runtime, frontend, backend, testing, deployment, and automation gaps visible.

**Never do:** execute project commands during onboarding; install software; launch services; ask the developer to inspect raw generated files just to understand the main blockers; treat detection as proof.

## Acceptance criteria

### AC-1: Quantified understanding summary [MUST]

Given a read-only onboarding run, when DevHarness compiles the repository understanding plan, then it includes a revision-bound summary with deterministic counts for proved, detected, unverified, conflict, and not-covered claims, plus a prioritized domain summary.

### AC-2: Conflict-first review surface [MUST]

Given contradictory documentation, code, or runtime signals, when the text brief is rendered, then conflicts are shown before generic warnings and the affected domain is named explicitly.

### AC-3: Database-first visibility [MUST]

Given a repository with database signals, when the brief is rendered, then the database row and database data-flow gaps are surfaced prominently before lower-priority warnings.

### AC-4: Compact text output [MUST]

Given the same onboarding plan, when the brief is rendered twice, then the summary order and counts are stable, and the output remains compact enough for one-screen review.

### AC-5: Schema-valid plan output [MUST]

Given the summarized onboarding plan, when JSON output is requested, then the new digest remains schema-valid, revision-bound, and read-only.

### AC-6: No new runtime authority [SHOULD]

Given the understanding digest, when it is generated, then it still does not install packages, start a browser or simulator, connect to a database, or execute consumer commands.

## Non-functional requirements

- The digest must be derived from existing plan data, not free-form model judgment.
- Missing or conflicting documentation should become visible evidence gaps, not hidden assumptions.
- The digest should improve developer review speed without changing the trust boundary.

## Out of scope

- Runtime proof, browser proof, simulator proof, database proof, or deployment proof.
- Goal planning, task graphs, or autonomous execution.
- Consumer-repo edits.
