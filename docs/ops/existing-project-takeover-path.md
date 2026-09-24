# Existing-project takeover path (ops)

How to point DevHarness at an **existing** (brownfield) consumer repository and progress from
understanding → baseline tests/fixes → gated feature work — using only commands and contracts that
exist in this public repo.

Companion methodology (product language):
[`docs/existing-project-onboarding-phases.md`](../existing-project-onboarding-phases.md).

Do **not** treat this as a greenfield “init and ship features” path. Feature Goal Runs that change
user-visible behavior belong in phase 3 only after phases 1–2 are real.

## Preconditions (environment / capabilities)

Before autonomous work:

| Prerequisite | Evidence / command |
| --- | --- |
| DevHarness checkout with Node ≥ 22 | root `package.json` `engines` |
| Consumer is a Git repo with a committed tip (prefer clean) | `doctor` capability `git-repository` / `clean-baseline` |
| Supervisor identity on this host | `devharness supervisor-init` |
| Project declaration | Tracked `devharness.yaml` **or** external file under `local-projects/<project>/` passed with `--config` |
| Bounded capabilities for later verify / browser / network / vcs-write | `request-capability` + foreground `approve` (TTY) |

Declaration patterns (`docs/devharness-quickstart.md`, `docs/doctor.md`):

```bash
# Dry-run proposal (writes nothing)
npm run devharness -- init --repo /path/to/consumer-project

# Option A — tracked declaration in the consumer (create-only)
npm run devharness -- init --repo /path/to/consumer-project --write

# Option B — leave consumer tree untouched
mkdir -p ./local-projects/example-cms
# save reviewed declaration JSON as ./local-projects/example-cms/devharness.yaml
npm run devharness -- doctor --repo /path/to/consumer-project \
  --config ./local-projects/example-cms/devharness.yaml
```

Generic dogfood loop (external config, clean consumer tree):
[`docs/dogfood/discovery-doctor-dogfood.md`](../dogfood/discovery-doctor-dogfood.md).

Harness-owned verify ordering when the consumer must not be patched:
[`docs/dogfood/example-cms-verification-recipe.md`](../dogfood/example-cms-verification-recipe.md).

## Phase map (mandatory order)

```text
Phase 1  Understand
    ↓
Phase 2  Test thoroughly and fix bugs (stabilize baseline)
    ↓
Phase 3  Goal-driven features (Align → controlled-change → verify → review → promote)
```

### Phase 1 — Understand

**Purpose:** make the repository known enough that later work is not guessing.

**Typical CLI surface (v0):**

```bash
npm run devharness -- onboard --repo /path/to/consumer-project [--config ...] [--write]
npm run devharness -- doctor  --repo /path/to/consumer-project [--config ...] [--format json]
npm run devharness -- build   --repo /path/to/consumer-project [--config ...] [--write]
```

- `onboard` — read-only understanding + bounded capability plan; `--write` stores externally, does
  not modify the consumer (`docs/onboarding-and-understanding.md`).
- `doctor` — deterministic readiness + autonomy level (`docs/doctor.md`).
- `build` — compile accepted declaration into a revision-bound project harness (preview unless
  `--write`).

**Exit when:** compact understanding of goals / stack / modules / test map exists; critical unknowns
listed; capabilities needed for phase 2 are approved or explicitly blocked. “Doctor green” or one
smoke receipt alone is **not** sufficient (`docs/existing-project-onboarding-phases.md`).

### Phase 2 — Test and fix bugs

**Purpose:** prove and stabilize **existing** behavior before adding surface area.

**Typical CLI surface:**

```bash
# Request any capabilities still blocking the verify plan, then TTY-approve
npm run devharness -- request-capability --run RUN_ID --for-verify [--command ID] [--approve]
npm run devharness -- approve --repo /path/to/consumer-project --run RUN_ID --pending

# Isolated execute + Supervisor attestation
npm run devharness -- verify --run RUN_ID --command COMMAND_ID --execute --attest \
  --repo /path/to/consumer-project [--config ...]
```

Use the consumer’s own verification ladder in a sensible order (startup → targeted unit → broader
system / browser). Triage fixture/contract vs environment vs product bugs. Expand coverage only
where phase 1 marked dangerous gaps — still baseline hardening, not feature invention.

When policy is harness-only (do not modify the consumer), prefer a declared DevHarness-owned
verification recipe under `local-projects/` rather than ad-hoc chat ordering
(`docs/existing-project-onboarding-phases.md`).

**Exit when:** agreed baseline suites are green (or failures classified with owners); severity bugs
from that pass fixed or explicitly deferred.

### Phase 3 — Goal-driven features

**Purpose:** only now accept goals that add or change behavior, under the two human gates.

## Align → controlled-change → verify → review → promote

After phases 1–2, a feature Goal Run uses the CLI path below. All commands are implemented in
`packages/cli/src/cli.mjs` (see `--help`).

```text
goal
  → advance / align (+ answer / request-capability as needed)
  → request-scope  (Gate 1) → approve
  → request-capability (vcs-write) → approve
  → advance --mode controlled-change [--change-json | --agent-propose]
  → verify --execute --attest
  → review-attest
  → request-delivery (Gate 2) → approve
  → promote [--push] [--pr]
```

### Concrete command sketch

```bash
REPO=/path/to/consumer-project
CFG=./local-projects/example-cms/devharness.yaml   # if using external config
DH="npm run devharness --"

# Create durable Goal Run (clean committed tip; does not start an agent)
$DH goal --repo "$REPO" --goal "Describe the bounded user-visible outcome"

# Static discovery / clarifying checkpoint
$DH advance --repo "$REPO" --run "$RUN_ID"

# Live Alignment (tick with --continue after answers/approvals)
$DH align --repo "$REPO" --run "$RUN_ID"
$DH align --repo "$REPO" --run "$RUN_ID" --continue
# optional: $DH answer --run "$RUN_ID" ...

# Gate 1 — scope
$DH request-scope --repo "$REPO" --run "$RUN_ID"
$DH approve --repo "$REPO" --run "$RUN_ID" --pending

# After Gate 1: vcs-write, then controlled-change in an isolated worktree
$DH request-capability --repo "$REPO" --run "$RUN_ID" --capability vcs-write
$DH approve --repo "$REPO" --run "$RUN_ID" --pending
$DH advance --repo "$REPO" --run "$RUN_ID" --mode controlled-change \
  --change-json /path/to/changeSpec.json
  # or: --agent-propose [--agent ID]

# Verify on the change revision; attest via sealed drivers
$DH request-capability --repo "$REPO" --run "$RUN_ID" --for-verify --approve
$DH verify --repo "$REPO" --run "$RUN_ID" --command COMMAND_ID --execute --attest

# Independent review attestation (Gate 2 full profile)
$DH review-attest --repo "$REPO" --run "$RUN_ID"

# Gate 2 — delivery
$DH request-delivery --repo "$REPO" --run "$RUN_ID"
$DH approve --repo "$REPO" --run "$RUN_ID" --pending

# Publish isolated commit onto a branch; optional remote. Never force-push or merge.
$DH promote --repo "$REPO" --run "$RUN_ID" [--branch NAME] [--push] [--pr]
```

Status / review UI:

```bash
$DH status --repo "$REPO" --run "$RUN_ID"
npm run review-ui
$DH review --repo "$REPO" --ui-origin http://localhost:3000
```

### What “promote” does and does not do

- Publishes the isolated controlled-change commit onto a branch.
- Optional `--push` / `--pr`.
- **Does not** force-push, auto-merge, or auto-deploy (CLI help;
  `docs/devharness-quickstart.md`).

## Evidence rules (ops honesty)

- Prefer Supervisor-verified manifests over schema-valid legacy receipts
  (`docs/doctor.md`, `docs/verification-receipts.md`).
- Sealed drivers today (`docs/supervisor-provenance.md`):
  `command-test`, `command-quality`, `command-lifecycle`, `command-system`, `command-browser`,
  `independent-review`.
- Claim statuses for understanding (`detected` / `documented` / `code-confirmed` / …) are defined in
  `docs/onboarding-and-understanding.md` — detection never promotes itself to runtime proof.

## Gaps

| Gap | Ops implication |
| --- | --- |
| **Phase 2 still operator-led depth** | Doctor prints a Phase 2 command ladder idea, but thorough baseline hardening is not a single sealed “make healthy” button (`docs/existing-project-onboarding-phases.md` v0 note). |
| **Live Alignment ≠ full human depth** | CLI live alignment does not fully replace human-led depth for hard conflicts. |
| **PTY human gates** | `approve` requires a foreground TTY; it is not production-grade independent human authentication (`docs/supervisor-provenance.md`). |
| **No default remote push/PR** | `promote` is opt-in `--push`/`--pr`; no auto-merge. |
| **No Goal Run self-heal product** | `retry` is scoped to the last failed live Alignment phase; there is no claimed autonomous self-heal of arbitrary mid-run failures. |
| **No provider accounting** | No public CLI/doctor surface for token/cost accounting. |
| **Missing sealed drivers** | No sealed API / database / deployment / load / canary drivers yet (`docs/supervisor-provenance.md`). |
| **Isolation proof host scope** | L5 via `prove-isolation` is macOS Seatbelt today; not multi-host / remote Supervisor. |
| **Named private consumers** | This public tree documents generic paths (`example-cms`, `local-projects/<project>/`, `example-consumer`). Do not treat scrubbed or private consumer history as public proof. |

## Anti-patterns (from methodology)

- Treating harness wiring + one browser smoke as “ready for autonomous features.”
- Jumping to phase 3 while auth / DB / critical flows remain `unknown`.
- Asking for blank-check credentials instead of bounded capability ids.
- Declaring a consumer “red” under an unsafe test order, then patching the consumer when a
  harness-owned recipe would suffice.

## Related

- [`docs/existing-project-onboarding-phases.md`](../existing-project-onboarding-phases.md)
- [`docs/onboarding-and-understanding.md`](../onboarding-and-understanding.md)
- [`docs/ops/autonomy-maturity-map.md`](./autonomy-maturity-map.md)
- [`docs/supervisor-provenance.md`](../supervisor-provenance.md)
- [`docs/goal-runs.md`](../goal-runs.md)
- [`docs/devharness-quickstart.md`](../devharness-quickstart.md)
