# Verification receipts

## Plan first

`verify` accepts only a configured command ID and is non-executing by default:

```bash
npm run devharness -- verify \
  --repo ../some-project \
  --command root-build
```

The plan shows repository identity, revision, compiled harness ID, exact command, required services, timeout, isolation mode, and external artifact directory.

Execution is explicit:

```bash
npm run devharness -- verify \
  --repo ../some-project \
  --command root-build \
  --execute
```

An alternate external data root can be supplied through `--data-dir` or `DEVHARNESS_DATA_DIR`. A path inside the consumer repository is rejected.

## Preconditions

The runner refuses to start unless:

- The repository has a committed, clean baseline.
- Required submodules are initialized.
- Local environment files are ignored.
- Every locally set environment key is declared by a redacted example.
- `devharness.yaml` satisfies its public contract.
- The requested command ID exists in that config.
- The requested command is short-lived; direct `launch` execution is blocked.
- Any required service has an accepted launch command and one or more credential-free loopback HTTP readiness declarations.
- The timeout is between one second and 24 hours.

## Isolation

Execution occurs at the current commit in a detached external Git worktree. The original consumer working tree is not used as the command working directory.

The child inherits only common operating-system variables and explicitly declared project environment keys. It does not inherit unrelated API keys or credentials from the developer's shell.

For a configured verification job, DevHarness starts its declared service first and captures service logs. All declared loopback HTTP checks run concurrently and must return accepted statuses before the verification command starts. On every exit path the runtime sends SIGTERM, escalates to SIGKILL after the configured grace period, runs any declared bounded cleanup command, checks for non-ignored changes, and removes the worktree.

A command that modifies the verification checkout fails even if it exits zero. A readiness or teardown failure cannot produce a passing receipt.

## Receipt integrity

Each receipt records:

- Repository identity and commit.
- Exact configured command and hash.
- Compiled harness, declaration, verification-job, and lifecycle hashes.
- Service start, every readiness observation, exit, explicit cleanup, and teardown records.
- Environment contract without values.
- Workspace isolation and dirty-state checks.
- Start, completion, duration, exit, signal, and timeout.
- Checksummed command and service stdout/stderr artifacts.
- Teardown verdict.
- Runtime version and platform.

The runtime loads a receipt as intact only if its schema validates and every artifact still matches its size and hash. This is not issuer trust: a legacy receipt by itself never promotes doctor, delivery, behavior or understanding readiness.

## Supervisor evidence

A trusted evidence manifest requires an explicit Supervisor attestation:

```bash
npm run devharness -- supervisor-init
npm run devharness -- verify \
  --repo ../some-project \
  --command CONFIGURED_TEST_ID \
  --execute \
  --attest
```

The first sealed driver is `command-test@1`. It rechecks the intact receipt against the live clean repository, current HEAD and complete project declaration, then signs a manifest binding the criterion, command, harness, recipe, receipt, artifacts, driver implementation and issuer. It can emit only `test-result`; it cannot claim browser, network, API, database, filesystem, deployment or performance behavior.

Signed artifacts use canonical, domain-separated Ed25519 payloads and create-only external storage. Mutation, repository or revision replay, duplicate IDs, truncated files and symlinked paths fail closed.

## Not yet covered

- Dependency installation/bootstrap inside a fresh worktree.
- Browser/network/database evidence beyond command logs.
- Multiple concurrent services, dynamic port allocation, and container ownership.
- Container- or VM-level isolation.
- Sealed build, browser, API, database, review, deployment, load and canary drivers.
- Worker sandbox isolation from Supervisor state and signing material.

These are explicit next layers rather than claims made by the short-lived command runner.
