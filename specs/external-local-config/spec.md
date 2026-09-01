# External Local Project Configuration

Status: Approved by developer intent
Version: 1.0
Mode: Full
Last updated: 2026-08-31

## Goal

Let a developer test DevHarness against an existing repository without adding, editing or committing
DevHarness files in that repository.

## Acceptance criteria

### AC-1: Consumer repository stays unchanged [MUST]
Given an external configuration path, when DevHarness inspects, builds or plans verification for a
clean consumer revision, then it does not require `devharness.yaml` inside the consumer repository.

### AC-2: External configuration is explicit and bounded [MUST]
Given `--config PATH`, when PATH resolves inside the consumer repository, then DevHarness rejects it;
when it resolves outside, DevHarness parses and validates the normal public project-config contract.

### AC-3: Default behavior remains compatible [MUST]
Given no `--config`, when a command needs configuration, then DevHarness continues to use the tracked
consumer `devharness.yaml` behavior.

### AC-4: AIedu local candidate is external [MUST]
Given the approved AIedu declaration, when this change is complete, then AIedu_demo is Git-clean and
the candidate exists only in DevHarness's ignored local-projects area.

## Out of scope

- Starting Docker, databases, application services or Playwright in this change.
- Committing or pushing AIedu_demo changes.
- Weakening clean-code-revision or signed-capability requirements.
