# Repository discovery and doctor

`devharness doctor` is a read-only, deterministic assessment. It does not ask an agent to judge whether a repository is ready, and it never executes commands merely because it discovered them in a manifest.

## Usage

From DevHarness development source:

```bash
npm run devharness -- doctor --repo ../AIedu_demo
npm run devharness -- doctor --repo ../AIedu_demo --format json
```

The JSON form returns both the versioned repository snapshot and readiness report.

## Discovery boundary

Discovery reads:

- Git identity, current revision, branch, dirty count, submodule status, and remote host.
- Tracked and non-ignored repository file names.
- Package manifests, lockfiles, script names, and dependency names.
- Framework, platform, service, test-tool, CI, and agent-configuration markers.
- Environment key names from shallow environment-file discovery.

Discovery does not:

- Run build, test, launch, verification, or project scripts.
- Print environment values.
- Print credential-bearing remote URLs.
- Follow dependency, build, virtual-environment, or Git directories.
- Turn production compose files into proposed commands.
- Claim that a detected command works.

Local environment files are represented only by relative path, key name, whether a non-placeholder value is set, and whether Git ignores the file.

## Status semantics

- `pass`: established by deterministic static evidence or a current Supervisor-verified driver manifest.
- `warn`: a plausible capability was detected but has not been executed and proved.
- `fail`: a required capability is absent or unsafe.
- `not_applicable`: the repository does not need that capability.

A blocking `warn` keeps the overall verdict at `needs_work`. Finding Playwright or a test script is not enough to declare a repository ready.

Schema-valid command receipts are also insufficient. Doctor ignores caller receipt arrays and promotes executed capability only from manifests verified against the pinned external Supervisor identity. The first driver proves configured automated tests only. `supervisor-isolation` stays a blocking failure until a Supervisor-attested, host-scoped macOS Seatbelt proof shows workers cannot read Supervisor key, state, environment or control channel. Issue that proof with `devharness prove-isolation` (not worker self-attestation). Isolation proofs are bound to the Supervisor identity on this host, not to a consumer commit.

The score is a deterministic summary of weighted capabilities. It is diagnostic, not a completion verdict. The capability list and remediations are the source of truth.

## Autonomy levels

`overall.level` is a 0–5 maturity ladder for unattended agent work. It is computed only from capability statuses (never from the score):

| Level | Meaning |
| --- | --- |
| 0 | Not a usable Git repository |
| 1 | Repository identity only |
| 2 | Sealed build + automated tests |
| 3 | Sealed real-surface behavior + service launch (or N/A) |
| 4 | CI feedback + pull-request delivery detectable |
| 5 | Supervisor isolation proved (host-scoped Seatbelt) — workers cannot read Supervisor key, state, environment, or control channel |

When level is below 5, `overall.next_level_gap` names the missing capability ids and a one-line remediation (for example `devharness prove-isolation` for level 5). At level 5 the gap is `null`. Level 5 is the measurable prerequisite for unattended mid-gate Goal Run work between the two human gates; it does not remove those gates.


## Init safety

`devharness init` performs the same discovery and prints a proposed `devharness.yaml`:

```bash
npm run devharness -- init --repo ../AIedu_demo
```

It is a dry run by default. Writing requires an explicit flag:

```bash
npm run devharness -- init --repo ../AIedu_demo --write
```

The write uses create-only semantics and refuses to overwrite an existing declaration. Detected commands remain proposals until reviewed and verified.

The v0 file uses canonical JSON syntax, which is a strict subset of YAML 1.2. This permits dependency-free strict parsing and rejects YAML tags, anchors, and implicit coercions. Broader YAML syntax is not accepted yet.

## Harness compilation

After accepting the tracked declaration, `build` compiles a revision-bound project harness:

```bash
npm run devharness -- build --repo ../some-project
npm run devharness -- build --repo ../some-project --write
```

Local framework evaluation can load the same contract from outside the consumer without changing
its working tree:

```bash
npm run devharness -- doctor --repo ../some-project --config ./local-projects/example/devharness.yaml
npm run devharness -- build --repo ../some-project --config ./local-projects/example/devharness.yaml
```

Preview is pure and deterministic. Explicit write stores the manifest under the external DevHarness data root. The compiler resolves exact command references and reports launch commands without an explicit readiness declaration as blockers; it never invents a port or health endpoint.

For v0, a verification job may require at most one service. Readiness supports credential-free loopback HTTP only. Launch commands are proved by the sealed `command-lifecycle` driver: start the owned service, pass readiness, run a lifecycle probe (without re-spawning the launch command), then teardown. Doctor upgrades `service-launch` when a current-revision launch manifest exists.
