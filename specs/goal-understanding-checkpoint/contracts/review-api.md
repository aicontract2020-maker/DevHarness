# Contract: Current Interaction Read

## `GET /api/review/runs/:run-id/interaction`

Returns the schema-valid current interaction packet only when it belongs to the configured
repository's valid Goal Run and matches its current revision.

Errors: 400 invalid run ID; 401 missing/invalid token; 403 invalid origin; 404 missing run or no valid
current packet; 405 non-GET method; 500 safe generic failure. No mutation route is added.
