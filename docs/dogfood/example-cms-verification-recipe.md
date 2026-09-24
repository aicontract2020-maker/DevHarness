# Example CMS verification recipe (placeholder)

Generic dogfood notes for an external CMS-style consumer. Names here are
placeholders (`example-cms`); do not treat them as a real product identity in
core packages.

## Intent

Prove a local stack can start and pass an owned browser/smoke command without
editing the consumer repository.

## External config sketch

Keep the declaration under DevHarness (gitignored):

```text
local-projects/example-cms/devharness.yaml
```

Point `--repo` at the sibling consumer checkout, for example
`../example-cms`.

## Ordered verify (illustrative)

Prefer the consumer's own safe full-suite command when one exists. Example
shape only:

```json
{
  "id": "root-cy-run-ordered",
  "kind": "verify",
  "run": "npx cypress run --config-file cypress.config.js",
  "source": "DevHarness recipe placeholder (consumer untouched)"
}
```

Bind readiness probes and teardown to the project harness so DevHarness owns
lifecycle. Record receipts against the consumer tip commit.

## Guardrails

- Do not commit consumer-specific ports, credentials, or feature names into
  DevHarness core.
- Leave `local-projects/` gitignored.
- Stop at honest `blocked` / `failed` when evidence is missing.
