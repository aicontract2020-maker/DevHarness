# Contract: Goal and Status CLI

## `devharness goal --goal TEXT [--repo PATH] [--data-dir PATH] [--format text|json]`

Requires a non-empty goal and clean committed Git repository. Creates a new durable run externally.
Returns run ID, state, revision, review verdict, blocking count, path and next action.

Errors before storage: missing goal, non-Git repository, dirty repository or missing commit.

Satisfies AC-1, AC-7 and AC-8.

## `devharness status --run ID [--repo PATH] [--data-dir PATH] [--format text|json]`

Loads the event-backed run and current scorecard. Returns compact current state, revision, review
verdict, blocking count and next action. Does not mutate storage.

Errors: missing/invalid run ID, missing run, invalid event stream or contradictory cached snapshot.

Satisfies AC-2, AC-3, AC-4 and AC-8.

## `devharness review [--repo PATH] [--data-dir PATH] [--port N] [--ui-origin URL]`

Starts the authenticated loopback read service and prints a review-page URL whose fragment contains
the API origin and ephemeral token. It performs no consumer or run mutation.

Satisfies AC-5 and AC-6.
