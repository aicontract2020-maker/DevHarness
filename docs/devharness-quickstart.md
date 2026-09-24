# DevHarness quickstart

DevHarness helps a developer give one goal to an agent and get back a bounded, reviewable result.
It is designed to reduce two things at the same time:

- “I do not trust the agent’s understanding.”
- “I cannot review every generated file by hand.”

## Existing projects: three phases before features

1. Understand the project (goals, stack, architecture, test map) — including env and capabilities.
2. Test thoroughly and fix bugs until the baseline is stable.
3. Only then run goal-driven feature development.

Details: [existing-project-onboarding-phases.md](./existing-project-onboarding-phases.md).

## How to use it

### Generate `devharness.yaml` for a new project

Do this once per consumer repo before goal runs. From the DevHarness repository:

1. Dry-run discovery (prints a proposal; writes nothing):

   ```bash
   npm run devharness -- init --repo /path/to/your-project
   ```

   `init` scans platforms, package scripts, Playwright loopback base URLs, and launch/verify
   commands, then proposes a declaration. v0 stores that proposal as JSON inside
   `devharness.yaml` (a valid YAML 1.2 subset).

2. Persist the declaration in one of two ways:

   **Tracked file in the consumer repo** (normal shared integration):

   ```bash
   npm run devharness -- init --repo /path/to/your-project --write
   ```

   Creates `/path/to/your-project/devharness.yaml` only if it does not already exist
   (will not overwrite).

   **External file** (leave the consumer working tree untouched, as with example-consumer):

   ```bash
   mkdir -p ./local-projects/my-project
   # Review the dry-run proposal, then save the declaration JSON as:
   # ./local-projects/my-project/devharness.yaml
   ```

   Later commands pass that path explicitly:

   ```bash
   npm run devharness -- doctor --repo /path/to/your-project \
     --config ./local-projects/my-project/devharness.yaml
   npm run devharness -- build --repo /path/to/your-project \
     --config ./local-projects/my-project/devharness.yaml
   ```

   A `--config` path inside the consumer repository is rejected in external mode.
   Omitting `--config` uses the tracked `devharness.yaml` workflow.

3. Validate and compile:

   ```bash
   npm run devharness -- doctor --repo /path/to/your-project [--config ...]
   npm run devharness -- build  --repo /path/to/your-project [--config ...]
   npm run devharness -- build  --repo /path/to/your-project [--config ...] --write
   ```

What `init` fills in automatically:

- `project.id` from the repository name
- detected `platforms`
- `quality.commands` from discovery
- `harness.services` / verifications when a single Playwright loopback URL can be inferred
- `autonomy.required_gates`: `scope`, `delivery`
- `delivery.provider`: `github` or `manual`

You will usually still hand-edit launch commands, readiness URLs, and command IDs.
`init` does not invent health routes or ports.

### Run a goal against a repo

1. Point DevHarness at a repo.

   It scans the repository, discovers the project shape, and summarizes what it already knows and
   what it still does not know.

2. Give it one goal.

   Example:

   ```bash
   npm run devharness -- goal --repo ../example-consumer --goal "Add password reset"
   ```

3. Read the compact brief.

   DevHarness shows a short answer to four questions:

   - What outcome is it trying to deliver?
   - What does it believe about the repo?
   - What is still uncertain?
   - What proof will count?

4. Approve only the exact missing boundary.

   If DevHarness needs browser access, database access, service startup, or another bounded
   capability, it asks for that specific approval. It does not ask for a blank check.

5. Let it plan, split, implement, and verify.

   DevHarness can move through clarification, research, planning, team split, implementation, and
   verification. It keeps those stages separate so the developer can inspect each one.

6. Review evidence, not self-report.

   DevHarness prefers real proof:

   - browser or simulator checks for user-facing behavior;
   - database checks for data changes;
   - unit tests for small modules;
   - system tests for end-to-end behavior;
   - deployment or automation checks when they are part of the goal.

7. Review the delivery brief.

   At the end, DevHarness shows what changed, what was proven, and what is still blocked.

## What the developer experiences

The normal interaction is small and repetitive on purpose:

```text
goal
  -> repo understanding
  -> brief
  -> exact approval if needed
  -> plan
  -> implementation
  -> verification
  -> review
  -> delivery brief
```

The developer mostly handles exceptions, not every intermediate step.

## Why this is safer than “just let the agent run”

DevHarness does not rely on a model’s self-report. It makes the agent show:

- what it understood;
- what it changed;
- what it tested;
- what it actually observed.

It also keeps the consumer repository separate from the framework state.

## What the current version can do well

- Explain a repo before running anything.
- Surface missing assumptions early.
- Bind browser verification to a real local service when the repo already has a clear browser base URL.
- Show a compact review surface instead of a pile of raw artifacts.
- Keep proof attached to the run.

## What it still does not do

- Auto-merge.
- Auto-deploy.
- Pretend every project can be verified the same way.
- Replace a project’s own build, tests, or CI.

## If you want more detail

- [Bounded v0 walkthrough](./single-agent-goal-runtime/walkthrough.md)
- [README](../README.md)

