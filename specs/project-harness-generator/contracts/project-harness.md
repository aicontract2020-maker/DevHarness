# Contract: Project Harness Compilation

## Inputs

- A contract-valid `devharness.yaml` accepted by the developer.
- A repository snapshot with a clean committed revision.
- An external DevHarness data root.

## Declaration rules

- Every service ID is unique and references exactly one configured `launch` command.
- Every verification job references exactly one configured `verify` command.
- A verification job references zero or one declared service in v0.
- HTTP readiness targets use `http`, a loopback hostname, no credentials, no query, and no fragment.
- Reference or target violations fail before persistence.
- The `harness` section is optional for backward-compatible v1 declarations; absence compiles to no services or verification relationships and produces honest blockers for discovered lifecycle commands.

## Manifest output

The compiled manifest contains:

- Schema version and deterministic harness ID.
- Repository identity and exact commit SHA.
- SHA-256 of the accepted project declaration.
- Platform-pack identifiers.
- Resolved command records with command SHA-256 values.
- Resolved service and verification relationships.
- Blocking gaps that prevent lifecycle proof.

The manifest contains no timestamp or absolute consumer path. Identical semantic input produces the same ID and content.

## Persistence

- Preview returns the manifest and intended external path without writing.
- Explicit write validates the manifest, creates mode-0700 parents, and atomically renames a mode-0600 temporary file.
- Existing byte-identical content is idempotent; conflicting content at the same harness ID is an error.

## Error outcomes

- `INVALID_REFERENCE`: command/service relationship is unknown or wrong-kind.
- `UNSAFE_READINESS_TARGET`: URL violates the loopback policy.
- `CONSUMER_STORAGE`: requested data root resolves inside the consumer repository.
- `DIRTY_BASELINE`: the repository snapshot is not a clean committed revision.
