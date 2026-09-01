# Plan: Durable Goal Run Review

## Approach

1. Add deterministic Goal Run creation and replay in core. Creation receives ID and time so tests
   control nondeterminism; replay treats events as source and checks the cached snapshot.
2. Extend external filesystem storage with a create-only per-run directory containing event files,
   a cached snapshot and current scorecard. Readers validate contracts, reject links and cap lists.
3. Add CLI `goal` and `status` commands. Goal intake creates only durable facts and an honestly
   blocked scorecard; status is a compact projection.
4. Add a loopback-only read service. A 256-bit process token and exact allowed origin protect the
   run index and scorecard endpoints; no mutation route exists.
5. Make the review page load the service location and token from the URL fragment, select runs and
   poll every five seconds. Keep the bundled fixture as an explicit disconnected fallback.

## AC mapping

| AC | Components |
|----|------------|
| AC-1 | Core goal creation, run store, CLI goal |
| AC-2 | Core replay, event reader, snapshot comparison |
| AC-3 | Create-only writer, safe regular-file reader, validated listing |
| AC-4 | CLI status formatter |
| AC-5 | Review service authorization and routing |
| AC-6 | Review index plus UI connection/selection hook |
| AC-7 | Initial scorecard projection and UI source badge |
| AC-8 | External path policy and CLI integration tests |
| AC-9 | Bounded review index |

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Arbitrary websites read localhost run data | High | Exact Origin plus random token; loopback binding; no-store |
| Snapshot and events disagree after interruption | High | Events are authoritative; mismatch is rejected, never silently repaired |
| Partial creation looks valid | High | Create-only directory; event first, snapshot and scorecard atomic; incomplete runs omitted |
| Initial scorecard implies work occurred | High | Zero score, blocking gates and explicit runtime state `received` |
| UI polling leaks timers or shows stale selection | Medium | Abortable five-second refresh and selection reset on index change |
| New abstractions precede real need | Medium | One filesystem store and one read-only transport; no database or plugin interface |

## No migration

No existing Goal Run storage exists. Existing verification, harness and onboarding directories are
unchanged.
