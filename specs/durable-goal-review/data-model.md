# Data model: Durable Goal Run Review

## External layout

```text
<data-root>/projects/<repository-key>/runs/<run-id>/
  events/00000001.json
  snapshot.json
  review/scorecard.json
```

## Goal Run

Uses `goal-run.schema.json`. The snapshot is a replaceable cache; validated events are authoritative.

## Run Event

Uses `run-event.schema.json`. One immutable file per sequence avoids partial JSONL tails. Sequence 1
is `run.created` and contains the initial Goal Run snapshot.

## Review Scorecard

Uses `review-scorecard.schema.json`. The current scorecard is replaced atomically after a review
checkpoint. It is a projection, never source state.

## Review Run Index

A bounded read model containing repository identity and at most 100 run summaries: run ID, title,
state, revision, update time, verdict, score, blocking count and scorecard endpoint.

## Relationships

- One repository has many Goal Runs.
- One Goal Run has one ordered event stream.
- One Goal Run has zero or one current Review Scorecard.
- Every run, event and scorecard repeats the same run ID; every scorecard repeats repository identity
  and current revision.

## Integrity rules

- Directory names derive only from schema-valid IDs and a hashed repository identity.
- Readers accept regular files only and do not follow symbolic links.
- Event sequences are contiguous and begin at one.
- A cached snapshot must equal replayed state exactly.
- A scorecard must match the loaded run ID, repository identity and current revision.
