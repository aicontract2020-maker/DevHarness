# Durable Goal Runs

DevHarness can now record a real goal before any agent work begins:

```bash
npm run devharness -- goal --repo ../some-project --goal "Add password reset"
```

The repository must be clean and committed. DevHarness stores the run, its creation event and an
initial review scorecard under the external data root. It does not write to the project and it does
not start an agent. The first scorecard is deliberately blocked with zero proof until understanding,
acceptance criteria, an accepted harness, evidence and independent review exist.

Use the returned run ID to recover compact status from the event stream:

```bash
npm run devharness -- status --repo ../some-project --run RUN_ID
```

Advance the run through the first safe checkpoint:

```bash
npm run devharness -- advance --repo ../some-project --run RUN_ID
```

This performs static discovery only. It stores the repository snapshot and onboarding plan, records
the `received -> discovering -> clarifying` events, and publishes one traceable Alignment Brief.
Because no project command, browser, simulator or database has run and acceptance criteria do not
exist yet, the brief is `action-required` and has no approve action.

Request one of the exact capabilities already present in that checkpoint:

```bash
npm run devharness -- request-capability --repo ../some-project \
  --run RUN_ID --capability browser-runtime
```

The caller supplies only the stable capability ID. DevHarness loads the current intact onboarding
artifact and derives the subject hash; caller-provided capability hashes are rejected. The review
page then shows the exact operation, target, scope, risk, authority, reason and pending request. The
single next command opens the foreground Supervisor decision:

```bash
npm run devharness -- approve --repo ../some-project --request REQUEST_ID
```

That prompt repeats the full bounded capability before accepting an exact request-specific approve
or reject phrase. Pending, expired, stale and rejected requests never grant execution authority.

## Live developer review

Start the UI, note its exact local origin, then start the read-only runtime connection:

```bash
npm run review-ui
npm run devharness -- review --repo ../some-project --ui-origin http://localhost:3000
```

Open the URL printed by `review`. The page lists current runs, preserves the selected run and
refreshes every five seconds. If the service stops, the page labels the connection offline rather
than silently substituting runtime claims. If no connection is supplied, it clearly displays the
contract fixture as sample data.

## Storage and trust

- Runs are keyed by repository identity and stored outside the consumer repository.
- One immutable JSON file represents each event sequence; events are authoritative.
- Sequence one uses the original layout. Later advances publish a complete immutable checkpoint and
  atomically replace `current.json`; unreferenced partial checkpoints are ignored.
- The current cached snapshot must exactly match event replay.
- The current scorecard must match run ID, repository identity and revision.
- The current interaction packet must pass semantic traceability policy and match the run revision.
- Capability subjects must hash to the current checkpoint's intact onboarding request.
- Capability decisions must be current signed Supervisor receipts for the same run and revision.
- Partial, malformed, linked or contradictory runs are omitted from review.
- The read service binds to loopback, uses a new 256-bit token for each process, permits one exact
  UI origin, supports GET only and marks every response `no-store`.

The review page shows the current Alignment Brief before its delivery scorecard and reports how many
hashed sources and compressed details it represents. This transport makes runtime facts visible; it does not make them trusted evidence. Delivery still
requires Supervisor-verified evidence, independent review and both human gates.
