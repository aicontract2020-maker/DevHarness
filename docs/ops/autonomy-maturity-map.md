# Autonomy maturity map (ops)

Operator-facing map of DevHarness autonomy levels as **doctor reports them today**, what each level
means in practice, and what is proved in this public repository versus still missing.

Evidence sources (read these for detail):

- `docs/doctor.md` — autonomy ladder and doctor semantics
- `packages/project/src/doctor.mjs` — `computeAutonomyLevel`, `nextAutonomyLevelGap`, capability ids
- `docs/supervisor-provenance.md` — sealed drivers, human gates, isolation proofs
- `packages/runtime/src/supervisor-evidence.mjs` — sealed `command-*` / `independent-review` drivers
- `packages/runtime/src/supervisor-isolation.mjs` — host-scoped Seatbelt isolation
- `packages/cli/src/cli.mjs` — command surface (`doctor`, `prove-isolation`, Goal Run flow, `promote`)

This is an ops summary, not a product roadmap. For longer-term intent see
[`docs/devharness-autonomy-roadmap.md`](../devharness-autonomy-roadmap.md).

## How doctor reports autonomy

`devharness doctor` is read-only and deterministic. It never executes project scripts merely because
it discovered them.

JSON / text reports expose:

| Field | Meaning |
| --- | --- |
| `overall.level` | Integer **0–5** maturity for unattended agent work |
| `overall.next_level_gap` | When level &lt; 5: `{ next_level, missing[], summary }`; at level 5: `null` |
| `overall.verdict` / `score` | Diagnostic readiness (`ready` / `needs_work` / `unsupported`) and weighted score — **not** the autonomy ladder |
| `capabilities[]` | Per-id status: `pass` \| `warn` \| `fail` \| `not_applicable` |

Level is computed **only from capability statuses**, never from the score
(`computeAutonomyLevel` in `packages/project/src/doctor.mjs`).

Human-readable doctor output includes a line like:

```text
Readiness: needs_work (NN/100), autonomy level N/5
…
Next autonomy level (M/5): <one-line remediation>
```

## Levels (L0–L5)

Aligned with `docs/doctor.md` and the comment block above `computeAutonomyLevel`:

| Level | Meaning | Required capability statuses |
| --- | --- | --- |
| **0** | Not a usable Git repository | `git-repository` ≠ `pass` |
| **1** | Repository identity only | `git-repository` = `pass` (and not yet L2) |
| **2** | Sealed build + automated tests | `build-command` = `pass` **and** `automated-tests` = `pass` |
| **3** | Sealed real-surface behavior + service launch (or N/A) | L2 + `behavior-verification` = `pass` **and** `service-launch` ∈ {`pass`, `not_applicable`} |
| **4** | CI feedback + pull-request delivery detectable | L3 + `ci-feedback` = `pass` **and** `pull-request-delivery` = `pass` |
| **5** | Supervisor isolation proved (host-scoped Seatbelt) | L4 + `supervisor-isolation` = `pass` |

**L5 meaning (ops):** workers are proved unable to read Supervisor key, state, environment, or
control channel on this host. Doctor promotes `supervisor-isolation` only from a current
Supervisor-attested isolation proof (`isolationProofSatisfiesDoctor`), issued via
`devharness prove-isolation` — not worker self-attestation. Proofs are bound to the Supervisor
identity on this host, **not** to a consumer commit SHA.

L5 is the measurable prerequisite for **unattended mid-gate Goal Run work between the two human
gates**. It does **not** remove Gate 1 (scope) or Gate 2 (delivery).

### `next_level_gap` remediations (code)

From `nextAutonomyLevelGap`:

| Current level | `missing` capability ids (when not `pass`) | Summary gist |
| --- | --- | --- |
| &lt; 1 | `git-repository` | Initialize Git + baseline commit |
| &lt; 2 | `build-command`, `automated-tests` | Seal Supervisor-attested build and automated-test evidence at current revision |
| &lt; 3 | `behavior-verification`, `service-launch` | Seal real-surface behavior + service launch (or mark launch N/A) |
| &lt; 4 | `ci-feedback`, `pull-request-delivery` | Add CI feedback and a supported PR delivery remote (e.g. GitHub) |
| &lt; 5 | `supervisor-isolation` | Run `devharness prove-isolation` (macOS Seatbelt) |

## Capability ids that feed the ladder (and related)

Ladder gates use these ids specifically. Doctor also reports additional capabilities that affect
verdict/score but do not change the level formula:

**Ladder-critical**

- `git-repository`
- `build-command` — sealed Supervisor build / quality attestation at current revision
- `automated-tests` — sealed `command-test` attestation
- `behavior-verification` — verify receipt **plus** structured real-surface evidence
- `service-launch` — sealed lifecycle launch / readiness / teardown (or N/A when no long-running service)
- `ci-feedback` — CI workflow files detected (static)
- `pull-request-delivery` — e.g. `github.com` among remote hosts (static detectability)
- `supervisor-isolation` — host-scoped Seatbelt proof

**Also reported (not in level formula)**

- `clean-baseline`, `supported-platform`, `project-config`, `dependency-lock`
- `environment-contract`, `submodules-ready`, `worktree-isolation`

Status semantics (`docs/doctor.md`): `pass` needs deterministic static evidence **or** a current
Supervisor-verified driver manifest; detecting a script without sealed proof stays `warn`.

## What is proved in-repo today

Honest inventory of public-repo machinery (not consumer dogfood history):

| Area | Evidence in public repo |
| --- | --- |
| Autonomy ladder + gap reporting | `packages/project/src/doctor.mjs` (`computeAutonomyLevel`, `nextAutonomyLevelGap`); `docs/doctor.md` |
| Sealed evidence drivers | `packages/runtime/src/supervisor-evidence.mjs`: `command-test`, `command-quality`, `command-lifecycle`, `command-system`, `command-browser`; plus `independent-review` (see `docs/supervisor-provenance.md`) |
| Doctor ignores caller receipt arrays | Only Supervisor-verified manifests promote executed capability (`evaluateReadiness` voids legacy receipts) |
| Isolation proof path | `devharness prove-isolation` → `packages/runtime/src/supervisor-isolation.mjs` (macOS `sandbox-exec` Seatbelt probes); doctor capability `supervisor-isolation` |
| Human gates (scope / delivery) | CLI: `request-scope`, `request-delivery`, `approve`; docs: `docs/supervisor-provenance.md`, `docs/goal-runs.md` |
| Controlled change + promote (no auto-merge) | `advance --mode controlled-change`; `promote [--push] [--pr]` — CLI help states never force-pushes or merges |
| External state / consumer separation | External data root; optional `--config ./local-projects/<project>/devharness.yaml` (`docs/doctor.md`, dogfood placeholders under `docs/dogfood/`) |
| Goal Run skeleton | `goal`, `advance`, `status`, `align`, `verify --execute --attest`, `review-attest`, `review` UI connection |

## Gaps

Explicitly **not** claimed as complete in this public repo / docs:

| Gap | Why it matters | Where called out |
| --- | --- | --- |
| **PTY / human authentication** | Foreground TTY approval is not independent human auth; an agent that can allocate or control a PTY could answer the prompt. Approval receipts must not be treated as production-grade human authority until authenticated control + worker isolation land. | `docs/supervisor-provenance.md` (Human approval flow) |
| **Default remote push / PR** | `promote` can optionally `--push` / `--pr`, but DevHarness does **not** auto-merge. L4 only requires **detectable** CI + PR remotes — not automated push-by-default or continuous remote delivery. | CLI `promote` help; `docs/devharness-quickstart.md` (“Auto-merge” under what it still does not do) |
| **Goal Run self-heal** | No in-repo operator doc or sealed loop that claims automatic mid-run self-heal / unbounded repair. Bounded `retry` exists for live Alignment phase failure; that is not a general Goal Run self-heal product. | CLI `retry` (Alignment-scoped); absence of self-heal claims in doctor / goal-runs docs |
| **Provider accounting** | No public metering / token-budget / provider cost accounting surface in doctor or CLI docs. | Not present under `docs/` or CLI help |
| **Sealed drivers beyond command / browser / independent-review** | No sealed API, database, deployment, load, or canary driver yet. | `docs/supervisor-provenance.md` (Deliberate limitations) |
| **Remote Supervisor / multi-host trust** | No remote Supervisor, hardware-backed key, key rotation, or multi-host trust. | Same |
| **Full goal daemon** | No full goal daemon; Goal Runs are CLI-driven with durable external state. | Same; `docs/mvp.md` milestones still list live proof / governed transitions as incomplete in places |
| **macOS-only isolation proof** | `prove-isolation` / Seatbelt path is macOS-oriented; other hosts cannot earn L5 via that proof today. | `docs/doctor.md`, remediation strings in `doctor.mjs` |

## Ops checklist (raise level honestly)

1. Clean Git consumer tip + supported platform + valid `devharness.yaml` (tracked or external `--config`).
2. `supervisor-init`, then seal build/test/verify/launch via `verify --execute --attest` (and related) so doctor sees Supervisor manifests — not raw receipts.
3. Ensure CI files and a supported PR remote exist when targeting L4.
4. On macOS: `devharness prove-isolation` for L5; re-run doctor and confirm `overall.next_level_gap` is `null`.
5. Keep treating Gate 1 / Gate 2 TTY approvals as necessary human control — L5 does not erase them.

## Related

- [`docs/doctor.md`](../doctor.md)
- [`docs/supervisor-provenance.md`](../supervisor-provenance.md)
- [`docs/goal-runs.md`](../goal-runs.md)
- [`docs/ops/existing-project-takeover-path.md`](./existing-project-takeover-path.md)
