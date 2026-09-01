# Contract: Local Review API

Base URL: loopback HTTP origin chosen at process start.

Every `/api/review/*` request requires:

- `Origin` exactly equal to the configured UI origin.
- `X-DevHarness-Review-Token` equal to the process-issued 256-bit token.

Every response includes `Cache-Control: no-store` and the exact allowed CORS origin.

## `OPTIONS /api/review/*`

Returns 204 only for the configured origin and requested GET/header policy. Other origins return 403.

## `GET /api/review/runs`

Returns a schema-valid Review Run Index with at most 100 summaries, newest first.

Errors: 401 missing/invalid token; 403 invalid origin; 405 non-GET method; 500 safe generic error.

Satisfies AC-5, AC-6 and AC-9.

## `GET /api/review/runs/:run-id/scorecard`

Returns the schema-valid current scorecard only when the run belongs to the configured repository and
the scorecard matches its current revision.

Errors: 400 invalid run ID; 401 missing/invalid token; 403 invalid origin; 404 missing or invalid run;
405 non-GET method; 500 safe generic error.

Satisfies AC-5 and AC-6.

## No mutation contract

POST, PUT, PATCH and DELETE are always 405. The page has no approval or repair endpoint.
