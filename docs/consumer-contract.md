# Consumer contract

## Separation rule

DevHarness framework source and a consumer application's source live in separate repositories.

A consumer repository may contain only project-owned integration declarations and tests. It must not vendor DevHarness packages, agent adapters, platform-pack implementation, orchestration state, or run evidence.

For the first dogfood setup:

```text
film-making/
  DevHarness/     independent framework repository
  example-consumer/     independent consumer repository
```

## Consumer-owned files

The normal shared integration is one tracked declarative file:

```text
devharness.yaml
```

Illustrative shape:

```yaml
version: 1

project:
  id: example-web-app

detect:
  platforms: auto

quality:
  commands:
    - id: backend-tests
      run: ./scripts/test-backend
    - id: frontend-checks
      run: ./scripts/test-frontend

harness:
  services:
    - id: web
      command_id: frontend-dev
      readiness:
        kind: http
        url: http://127.0.0.1:3000/health
        expected_statuses: [200]
        timeout_ms: 60000
        interval_ms: 250
        additional_checks:
          - kind: http
            url: http://127.0.0.1:8000/health/ready
            expected_statuses: [200]
            timeout_ms: 60000
            interval_ms: 250
      shutdown:
        grace_ms: 5000
        run: docker compose down --volumes --remove-orphans
        timeout_ms: 60000
  verifications:
    - command_id: browser-smoke
      service_ids: [web]

autonomy:
  required_gates: [scope, delivery]

delivery:
  provider: github
  target: pull-request
```

The real schema will be generated through repository discovery; users should not need to write this file from scratch.

For local evaluation, the same declaration may instead live outside the consumer repository and be
selected explicitly with `--config PATH`. This mode leaves the consumer Git working tree untouched;
the external declaration is still validated and hashed with the exact clean consumer commit. Paths
inside the consumer repository are rejected in external mode, so a local trial cannot quietly become
an untracked project modification.

Project tests added because an application lacked meaningful behavior coverage remain application code and belong in the consumer repository. Generic test drivers and evidence collectors belong in DevHarness packs.

## Externally stored runtime data

The following data lives in a configurable user-level DevHarness data directory, keyed by repository identity and run ID:

- Goal artifacts and event logs.
- Worktrees and task workspaces.
- Generated agent configuration.
- Process state and leases.
- Screenshots, traces, logs, and reports.
- Supervisor public identity, protected private signing key, signed evidence manifests, approval requests and approval receipts.
- Temporary environment overlays.
- Adapter caches.

No absolute path is part of the portable contract.

The Supervisor state root is selected by the foreground Supervisor process, never by a goal or consumer declaration. Worker sandboxes must not receive that root, its private key, or the Supervisor control channel.

## Secret handling

`devharness.yaml` declares required secret names but never values. Values come from a configured secret provider or an existing local environment after explicit authorization.

The runtime may report whether a key is missing, set, or placeholder-like. It must not print secret values into progress output or artifacts.

## Consumer compatibility lifecycle

1. `devharness init` detects the repository and proposes a configuration.
2. `devharness doctor` produces a readiness report and exact blockers.
3. `devharness build` previews the deterministic project harness; `--write` stores it in external runtime storage.
4. `devharness verify` proves that the generated harness itself can launch, observe, test, and clean up the project.
5. `devharness goal` may run only when required readiness capabilities pass.

Generated output is reproducible from the tracked declaration, repository commit, DevHarness version, pack versions, and authorized environment inputs.

## Framework development against a consumer

During local framework development, the CLI receives the consumer path explicitly:

```bash
devharness doctor --repo ../example-consumer
devharness goal --repo ../example-consumer "..."
devharness doctor --repo ../example-consumer --config ../DevHarness/local-projects/example-consumer/devharness.yaml
```

This path is development-time input, not a permanent coupling between repositories.
