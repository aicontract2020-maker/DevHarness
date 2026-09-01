# Authorized Execution Gate

Status: Implemented and validated
Version: 1.0
Mode: Full
Last updated: 2026-08-31

## Overview

Prevent autonomous project execution unless the exact current Goal Run, accepted project
declaration, compiled verification plan and signed capabilities agree.

## Boundaries

**Always do:** require a clean current revision, accepted declaration, exact plan and current signed
capabilities; report every missing authority before execution.

**Never do:** treat `--execute`, a discovered command, a pending receipt or a browser-only grant as
permission to start project processes; infer database or credential authority.

## Acceptance criteria

### AC-1: Goal Run required for public execution [MUST]

Given the public verification command, when execution is requested without a Goal Run, then it
stops before compiling or running a consumer command.

### AC-2: Deterministic capability requirements [MUST]

Given an exact verification plan, when authority is evaluated, then process execution is always
required, browser automation additionally requires browser authority, and container commands
additionally require container authority.

### AC-3: Exact current authorization [MUST]

Given a plan and Goal Run, when any required capability is unrequested, pending, rejected, expired,
stale or bound to another revision, then execution stops and names every missing capability.

### AC-4: Accepted project declaration required [MUST]

Given an approved browser capability but no accepted project declaration, when execution is
prepared, then the next action is declaration review and no project process runs.

### AC-5: Existing dry-run remains safe [SHOULD]

Given verification without `--execute`, when the developer previews it, then no execution authority
is consumed and no project process runs.

## Non-functional requirements

- Policy evaluation is pure and deterministic.
- Missing authorities are reported in stable priority order.
- The guard runs before worktree creation or child-process spawn.

## Out of scope

- Installing dependencies or writing `devharness.yaml`.
- Executing browser, database, container or service drivers.
- Granting additional capabilities.
