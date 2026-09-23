# Agent-runtime capability approval dogfood (DevHarness-only)

Stabilize multi-hour Alignment / goal loops without touching consumer repos
(especially **sunrise-cms**). Last updated: 2026-09-15.

## Root cause (why approvals died mid-run)

1. Capability approval requests defaulted to **60 minutes**
   (`packages/runtime/src/capability-authorization.mjs`,
   `packages/runtime/src/supervisor-approval.mjs`, CLI `--expires-minutes`).
2. `itemStatus` treats pending **and** decided grants as `expired` once their
   window passes — an *approved* `agent-runtime` becomes unusable after TTL.
3. Receipt expiry **cannot exceed** request expiry
   (`packages/core/src/approval-policy.mjs` → `approval_expiry_exceeds_request`).
4. Approving an already-expired pending request throws; the Goal Run itself is
   intact. Renew with `request-capability` (status `expired` / `stale` is
   requestable), then TTY `approve` again.

## Product fix (this repo)

- Default TTL: **`agent-runtime` → 720 minutes (12h)**, **`network-research` → 480 (8h)**, others **60**.
- Override anytime with `--expires-minutes N` (1–1440).
- Expired approve errors and `next_action` point at the renew command (Goal Run preserved).
- **Batch approve**: `approve --request a --request b` or `approve --run RUN --pending` (one TTY phrase).
- **TTL reuse**: `request-capability` reattaches an unexpired approved grant (or existing pending id) instead of forcing another TTY.
- **Packet answers**: repeated `--decision/--option` pairs share one APPROVE confirmation.

## Preconditions

```bash
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.nvm/versions/node/v24.18.0/bin:$HOME/homebrew/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd /Users/kaimaplespark/GAC/git/film-making/DevHarness
DH_ROOT="/Users/kaimaplespark/GAC/git/film-making/DevHarness"
```

Use a **clean committed** consumer or demo tree. Prefer **AIedu_demo** with the
external config (never edit sunrise-cms for this loop):

```bash
REPO="/Users/kaimaplespark/GAC/git/film-making/AIedu_demo"
CONFIG="/Users/kaimaplespark/GAC/git/film-making/DevHarness/local-projects/aiedu-demo/devharness.yaml"
DH="node packages/cli/src/cli.mjs"
```

Ensure Supervisor identity exists once:

```bash
$DH supervisor-init
```

## Tiny loop: request → approve → advance / align

### 1. Create / advance a Goal Run to clarifying

```bash
$DH goal --repo "$REPO" --config "$CONFIG" --goal "Summarize repository readiness for a docs-only Alignment pass"
# note RUN_ID from output
$DH advance --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
$DH status --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
```

Repeat `advance` until capabilities appear in status / next_action (clarifying + onboarding plan).

### 2. Request agent-runtime (12h default)

```bash
$DH request-capability --repo "$REPO" --config "$CONFIG" --run "$RUN_ID" --capability agent-runtime
# Optional explicit window for a long session:
# $DH request-capability ... --capability agent-runtime --expires-minutes 1440
```

Copy the printed `Request: approval-request-…` id.

### 3. Approve on a real TTY (required)

```bash
$DH approve --repo "$REPO" --config "$CONFIG" --request approval-request-…
# Type exactly: APPROVE approval-request-…
```

JSON / pipes are refused by design.

#### Batch approve (less TTY friction)

One foreground session can approve many pending requests for the same run:

```bash
# Explicit ids (repeat --request):
$DH approve --repo "$REPO" --config "$CONFIG"   --request approval-request-aaa --request approval-request-bbb
# Type exactly (space-separated, same order):
#   APPROVE approval-request-aaa approval-request-bbb

# Or approve every pending request for the run:
$DH approve --repo "$REPO" --config "$CONFIG" --run "$RUN_ID" --pending
# Type APPROVE <id1> <id2> … as listed in the prompt
```

Still requires a real TTY. Never silently auto-approves never-approved capabilities.

#### TTL reuse (no second approve for a live grant)

If `agent-runtime` / `network-research` / `service-runtime` / `dependency-install` /
`research-task-*` (or any capability) is **already approved and unexpired** for this
repository + run + subject, `request-capability` **reuses** that grant instead of
creating a new pending request:

```bash
$DH request-capability --repo "$REPO" --config "$CONFIG" --run "$RUN_ID" --capability agent-runtime
# → "Capability already approved within TTL" + existing receipt (no approve needed)
```

Re-requesting while **pending** returns the same pending request id (no duplicate).
Rejected / expired / stale still require an explicit renew + TTY approve.

#### Packet answers (one confirm for many decisions)

```bash
$DH answer --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"   --decision decision-a --option option-1   --decision decision-b --option option-2
# One APPROVE phrase naming every alignment-answer request id
```

### 4. Exercise Alignment / status (no sunrise edits)

```bash
$DH align --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
$DH status --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
```

### 4b. After answers + capability approvals, tick the live operation

`align` only bootstraps the bundle. It does **not** run research or the bounded
agent worker. After decisions are answered and capabilities (including
`agent-runtime` and any `research-task-*`) are approved, tick with:

```bash
$DH align --continue --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
# alias: $DH align --tick --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
$DH status --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
```

`--continue` will:

1. Reacquire/refresh the operation lease for this live CLI process. A dead
   owner is replaced. Do **not** run reconcile on an expired lease — that path
   TIMEOUT-fails the operation.
2. Bind `research_subject_ref` when exact HTTPS recipes/origins are available.
   Auto-attach network-research authority from current capability approval
   receipts (stamped onto the bound `subject_sha256`), then run approved
   research tasks through the research gateway when `fetch` + authority exist.
3. Tick `runBoundedAgentWorker` for `analysis-plan` → later phases when a
   matching adapter is registered.
4. Refresh status so unanswered decisions are counted separately from the
   original packet.

### Exact HTTPS research recipes (AIedu dogfood)

Continue accepts exact public HTTPS GET recipes via:

- `--research-recipes PATH`, or
- auto-load of `<config-dir>/research-recipes.json` next to `--config`

Tracked copy: `docs/dogfood/aiedu-demo-research-recipes.json`  
Dogfood path (next to external config): `local-projects/aiedu-demo/research-recipes.json`

```bash
$DH align --continue --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
# or explicitly:
$DH align --continue --repo "$REPO" --config "$CONFIG" --run "$RUN_ID" \
  --research-recipes /Users/kaimaplespark/GAC/git/film-making/DevHarness/docs/dogfood/aiedu-demo-research-recipes.json
```

Recipes are official public docs for the demo stack (PostgreSQL, Docker security,
Playwright, Next.js, Compose production). Binding sets `research_subject_ref`.

When `research-task-*` / `network-research` capability grants are already approved,
`--continue` **reuses those supervisor approval receipts** and stamps them onto the
bound subject's `subject_sha256` (epoch ≥ 1) so the research gateway can fetch.
No parallel attach CLI is required. If no matching approved receipt exists,
continue still prints the authority-receipt blocker and continues local analysis.

### Agent adapters: Codex (primary) and local-readonly (fallback)

Continue registers **both** builtin adapters:

| Adapter id | When it runs | What it can do |
|---|---|---|
| `codex` | Default when Codex CLI + parent credential are configured, or `--agent codex` | Real Codex `exec` for `analysis-plan` → `analysis-synthesis` → `analysis-validation` only. Read-only sandbox. No change/execute, no consumer writes, no Agent web/research tools. Provider traffic goes through the parent-owned loopback proxy. |
| `devharness-cli-local-agent` | Default when Codex is **not** configured, or `--agent devharness-cli-local-agent` | Local readonly stub for CI/dogfood without API keys. Writes honest `dogfood-local-stub` artifacts (not Codex). |

Profile id is `codex-readonly-analysis-v1` for both. An existing operation keeps
its recorded adapter on `--continue` unless you pass `--agent`. Do not expect
`--agent codex` to rewrite a previously approved local-readonly descriptor;
it only selects the worker backend for the next tick.

#### Alignment compression (conservative defaults)

When live Alignment is `question-blocked` with standard Clarify/Infer options:

```bash
$DH answer --repo "$REPO" --config "$CONFIG" --run "$RUN_ID" --infer-conservative
# one TTY APPROVE for the whole answer batch
```

When research tasks are waiting on capability approvals:

```bash
$DH request-capability --repo "$REPO" --config "$CONFIG" --run "$RUN_ID" --for-align --approve
# one TTY APPROVE for every missing research/network grant
$DH align --continue --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
```


#### Codex auth (required for a live provider call)

DevHarness does **not** mount login/session files into the Agent
(`--ignore-user-config`). Provider calls always go through the **parent-owned
loopback proxy**.

Credential resolution (parent process only):

1. `DEVHARNESS_PROVIDER_CREDENTIAL` or `OPENAI_API_KEY` from the environment, else
2. From `~/.codex/auth.json` when present:
   - `auth_mode=apikey` → `OPENAI_API_KEY` (origin default `https://api.openai.com`,
     child path prefix `/v1`)
   - `auth_mode=chatgpt` → `tokens.access_token` (+ optional `tokens.account_id` as
     `ChatGPT-Account-Id`) via the parent proxy (origin default
     `https://chatgpt.com`, child path prefix `/backend-api/codex` so upstream is
     `https://chatgpt.com/backend-api/codex/responses`)

The auth.json value is used **only by the parent proxy** — never copied into the
Agent sandbox, never logged, never committed, never mounted as Agent auth.
Prefer env export in CI; local dogfood can rely on an existing ChatGPT session
`auth.json` (`auth_mode=chatgpt`) or an API key.

```bash
# 1. Codex CLI. ChatGPT.app ships one; npm also publishes @openai/codex.
export DEVHARNESS_CODEX_PATH="/Applications/ChatGPT.app/Contents/Resources/codex"
# or: export PATH="$(dirname "$(command -v codex)"):$PATH"

# 2. Parent credential for the loopback provider proxy (never commit this).
# export OPENAI_API_KEY          # or: export DEVHARNESS_PROVIDER_CREDENTIAL
# If unset, parent loads from ~/.codex/auth.json:
#   auth_mode=apikey  → OPENAI_API_KEY
#   auth_mode=chatgpt → tokens.access_token (+ tokens.account_id)

# 3. Optional model / origin
# export DEVHARNESS_CODEX_MODEL="gpt-5.6-sol"
# export DEVHARNESS_CODEX_ORIGIN="https://api.openai.com"   # apikey
# export DEVHARNESS_CODEX_ORIGIN="https://chatgpt.com"      # chatgpt session (default when auth_mode=chatgpt)
```

Confirm the binary:

```bash
"$DEVHARNESS_CODEX_PATH" --version
# expect: codex-cli …
```

Live Codex continue (this is the dogfood command once auth is set):

```bash
$DH align --continue --agent codex --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
```

New Goal Runs: omit `--agent` and DevHarness will pick `codex` automatically
when both the CLI and a parent credential are present.

Optional real-binary smoke (still no CI network by default):

```bash
DVH_ENABLE_REAL_CODEX_SMOKE=1 node --test packages/runtime/test/live-alignment-codex-smoke.test.mjs
```

#### Fallback without keys

```bash
$DH align --continue --agent devharness-cli-local-agent --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
```

If Codex is requested but the executable or credential is missing, continue
keeps the operation `running` and prints `AUTH_UNAVAILABLE` setup steps
instead of inventing credentials, origins, or a Codex session.

`--tick` is an alias for `--continue`.

Optional bounded verify owned by the external config (AIedu), still without
editing sunrise-cms:

```bash
$DH doctor --repo "$REPO" --config "$CONFIG"
```

### 4b. Scope gate after ready Alignment Brief

When live Alignment reaches `ready`, request the human scope gate and approve it
on a TTY. Approving now writes `run.gates.scope.status = approved` onto the Goal
Run (and `status` / `align --continue` reconcile an existing Supervisor receipt
if the gate was still pending):

```bash
$DH request-scope --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
$DH approve --repo "$REPO" --config "$CONFIG" --request <scope-request-id>
$DH status --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
# expect gates.scope.status === approved
# next_action: Scope is approved. Continue with the next governed planning step…
```

### 4c. Post-scope plan → bounded external change → verify prep

After `gates.scope.status=approved`, the same `advance` command continues the
Goal Run (clarifying/planning/staffing/executing → `verifying`), writes a
**docs-only readiness summary outside the consumer repo**, and probes verify:

```bash
ARTIFACT_DIR="$DH_ROOT/local-projects/aiedu-demo/artifacts"
mkdir -p "$ARTIFACT_DIR"
$DH advance --repo "$REPO" --config "$CONFIG" --run "$RUN_ID" \
  --artifact-dir "$ARTIFACT_DIR" --command docs-readiness-summary --format json
# expect: mode=post-scope, run.state=verifying, summary under ARTIFACT_DIR
# consumer git status remains clean

export DEVHARNESS_READINESS_SUMMARY="$ARTIFACT_DIR/readiness-summary.md"
$DH verify --repo "$REPO" --config "$CONFIG" --run "$RUN_ID" \
  --command docs-readiness-summary --execute --attest --format json
```

Dogfood on `run-a4118507-2ea5-44ec-b5df-09a0e368dd28` (2026-09-15):
- advance succeeded → `verifying`, wrote
  `local-projects/aiedu-demo/artifacts/readiness-summary.md`
- worktree stayed clean (no AIedu product edits; sunrise untouched)
- verify stopped with a **precise remaining gate**:
  `Verification requires initialized submodules: database/course`
  (after that, capability authority for `service-runtime` / TTY approve remains
  the next possible gate before attestation)

The external config declares `docs-readiness-summary` as a lightweight `test`
command (no service lifecycle) under `local-projects/aiedu-demo/devharness.yaml`.

### 5. If a grant expires mid-session (renew without losing run state)

```bash
$DH status --repo "$REPO" --config "$CONFIG" --run "$RUN_ID"
# next_action will look like:
#   devharness request-capability --run <RUN> --capability agent-runtime --expires-minutes 720
$DH request-capability --repo "$REPO" --config "$CONFIG" --run "$RUN_ID" --capability agent-runtime
$DH approve --repo "$REPO" --config "$CONFIG" --request <new-request-id>
```

## Unit verification (no consumer required)

```bash
cd /Users/kaimaplespark/GAC/git/film-making/DevHarness
node --test packages/runtime/test/capability-authorization.test.mjs packages/runtime/test/supervisor-approval-batch.test.mjs packages/runtime/test/alignment-answer.test.mjs packages/runtime/test/live-alignment-authority.test.mjs packages/runtime/test/live-alignment-continue.test.mjs packages/runtime/test/post-scope-advance.test.mjs packages/cli/test/cli.test.mjs
# scope gate + post-scope regression:
node --test --test-name-pattern "request-scope then approve|post-scope advance" packages/cli/test/cli.test.mjs packages/runtime/test/post-scope-advance.test.mjs
```

## Out of scope

- Do **not** modify `/Users/kaimaplespark/GAC/git/sunrise-cms` for this dogfood.
- Consumer-specific Cypress recipes stay in `docs/dogfood/sunrise-cms-verification-recipe.md`
  and gitignored `local-projects/sunrise-cms/`.
