# Discovery and doctor dogfood (generic)

Read-only dogfood loop against an external consumer repository. Keep the consumer
Git tree clean; put any DevHarness declaration under gitignored
`local-projects/<consumer-slug>/`.

## Setup

```bash
REPO="../example-consumer"
CONFIG="./local-projects/example-consumer/devharness.yaml"
DH="npm run devharness --"
```

## Commands

```bash
$DH onboard --repo "$REPO"
$DH doctor --repo "$REPO"
$DH init --repo "$REPO"                 # dry-run proposal
$DH doctor --repo "$REPO" --config "$CONFIG" --format json
$DH build --repo "$REPO" --config "$CONFIG" --format json
```

## Pass criteria

- Consumer working tree stays clean (no framework files written into it).
- `doctor` / `build` bind to the consumer tip commit when using `--config`.
- Failures are honest (`needs-evidence` / blocked) rather than false green.

Replace `example-consumer` with your real sibling path; keep consumer-specific
ports, users, and stack out of DevHarness core packages.
