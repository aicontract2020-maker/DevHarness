# Contract: Verification Review

## GET /api/review/verifications

Authentication and origin rules are identical to existing review endpoints.

### Response 200

- `schema_version`: `1`
- `repository_identity`: exact repository identity
- `current_head_sha`: current reviewed revision
- `counts`: total, pass, fail, blocked, current, stale
- `latest`: nullable verification summary
- `verifications`: at most 20 newest-first summaries

Each summary contains id, optional Goal Run id, revision, current-revision flag, command id/kind,
start/completion/duration, stable outcome status/reason/summary, service/readiness counts, workspace
cleanliness, teardown status, artifact count, and achieved evidence level (`E0` or `E2`). It never
contains environment values or artifact contents.

### Errors

- `401 authentication_required`: token missing or invalid.
- `403 origin_denied`: origin differs from the configured review UI.
- `500 review_data_unavailable`: validated projection cannot be loaded.

### AC Coverage

AC-2, AC-3, AC-E1.

