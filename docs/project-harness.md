# Project harness compilation

The tracked `devharness.yaml` is source. The project harness is a compiled, revision-bound artifact stored outside the consumer repository.

## Preview and write

```bash
npm run devharness -- build --repo ../some-project
npm run devharness -- build --repo ../some-project --write
```

Preview performs repository and contract validation but does not create runtime directories or files. Explicit write validates again and atomically stores a mode-0600 manifest under the repository's identity-keyed external state directory.

## Deterministic inputs

The harness ID is derived from canonical semantic JSON containing:

- Repository identity and exact Git commit.
- SHA-256 of the accepted project declaration.
- Selected platform packs.
- Exact commands and hashes.
- Service launch, readiness, shutdown, and lifecycle hashes.
- Verification-to-service relationships and hashes.
- Honest unresolved blockers.

Timestamps and absolute consumer paths are excluded. Reordering JSON object keys does not change hashes.

## Lifecycle declarations

A v0 service references one accepted `launch` command and declares:

- A credential-free loopback HTTP URL.
- Accepted HTTP statuses.
- Readiness timeout and polling interval.
- Optional additional loopback checks; every check must pass.
- Grace period before forced termination.
- Optional explicit cleanup command and bounded timeout.

A verification job references one accepted `verify` command and zero or one service. The runtime automatically activates the service when that verification command is executed.

The lifecycle section is optional for compatibility with earlier v1 declarations. New `init` output includes it. An older declaration still supports short-lived command verification, while lifecycle and behavior relationships compile as blockers rather than becoming invalid configuration.

Launch commands that have no service declaration remain visible as harness blockers. DevHarness does not guess health routes, credentials, or ports.

## Current limit

This is the portable lifecycle foundation, not yet a complete Web Pack. Screenshots, Playwright traces, network evidence, database state, dynamic ports, dependency bootstrap, and container ownership remain later mechanisms.
