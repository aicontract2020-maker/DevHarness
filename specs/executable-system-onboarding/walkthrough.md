# Walkthrough: Executable System Onboarding

## 1. Developer asks for onboarding

`devharness onboard --repo PATH` enters through `packages/cli/src/cli.mjs`.
The command has no execution flag and performs no consumer command.

## 2. Repository facts are collected

`packages/project/src/discover.mjs` inspects Git, manifests, lockfiles, frameworks, service
signals, command declarations, CI, agent files and environment key names. Values remain
redacted.

## 3. Existing proof is checked

Doctor reads only valid current-revision receipts. Detected build/test/browser/database signals
remain detections unless a trusted receipt proves execution.

## 4. The understanding plan is compiled

`packages/project/src/onboard.mjs` creates claims and applicable-domain coverage, requests
bounded capabilities, surfaces blockers and chooses one next action. The onboarding-plan
schema rejects undeclared or malformed output.

## 5. The developer sees a compact brief

The formatter shows verdict, revision, confirmed count, five priority gaps, grouped authority
requests and one next step. Database and security gaps are intentionally prioritized. JSON
retains the complete drill-down.

## 6. Optional storage stays external

`--write` atomically stores mode-0600 JSON under the identity-keyed DevHarness data root.
The consumer repository remains unchanged.

## 7. Later goal work consumes governed contracts

Repository baseline, capability authority, system model, approved strategy, verification
policy, execution graph and task-progress contracts define what future drivers/workers must
produce. Pure policies reject stale/incomplete understanding, agent-approved high-risk access,
broken system references, shallow feature/release proof and unsafe parallel waves.

## 8. Honest stop

Until real platform drivers collect sufficient evidence, the plan ends as `needs-evidence`.
It does not claim the agent can yet take over the repository.

## Unrequested behavior

None. No consumer command, install, network request, browser, simulator, database, deployment,
agent dispatch, pull request, merge or production action was added.
