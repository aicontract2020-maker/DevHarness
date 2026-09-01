# Contract: Analysis Isolation and Research Gateway v1

## Purpose

Define enforceable access, resource and network boundaries for live alignment. AC coverage: AC-1,
AC-2, AC-4a, AC-9, AC-11, AC-12, AC-13, AC-14.

## Access Policy

Every invocation contains a closed policy:

```json
{
  "consumer": { "read": true, "write": false, "commit_sha": "..." },
  "host_read": ["runtime-system-libraries", "adapter-executable", "provider-proxy-client"],
  "host_write": ["runtime-attempt-directory"],
  "supervisor_access": false,
  "consumer_environment": false,
  "provider_transport": { "approved": true, "target_descriptor_sha256": "...", "proxy_policy_sha256": "..." },
  "research_network": { "approved": false, "authority_ref": null },
  "backend": "macos-seatbelt-v1",
  "profile_template_sha256": "...",
  "profile_instance_sha256": "..."
}
```

The persisted policy names categories and hashes, never secret paths/values. Private enforcement
resolves them. Access outside the resolved allowlist is denied and recorded. Adapter/process prompts
cannot alter this object.

## Enforcement Probe

### macOS v1 backend

The only real backend in this slice is `macos-seatbelt-v1`:

1. Materialize a detached immutable snapshot of the pinned commit outside the consumer root.
2. Create a mode-0700 attempt root and an empty private home.
3. Start a parent-owned loopback provider proxy on an unpredictable port. The proxy owns the real
   credential and requires a one-operation capability token passed to the worker (not a provider
   secret). It strips caller authorization, injects its own authorization, permits only
   descriptor-approved HTTPS origins and enforces the operation request/deadline budget. The token
   expires when the owned worker process group terminates and is never persisted.
4. Generate a Seatbelt profile that defaults to deny; permits required process/system-library reads,
   read-only snapshot access, writes only beneath the attempt root, and outbound connections only to
   the exact loopback proxy endpoint. It explicitly denies the original consumer path, Supervisor
   root, runtime parent state, Mach task inspection and unrelated process metadata.
5. Launch `/usr/bin/sandbox-exec -f <profile> <adapter argv>` with an allowlisted environment and the
   private home. Codex retains its inner read-only tool sandbox; the outer boundary is authoritative.
6. Own and monitor the complete process group; reconcile consumer inventory; terminate worker and
   proxy; prove cleanup.

Human approval binds `profile_template_sha256`, which contains only static maximum permissions,
provider/model configuration, feature disables and limit ceilings. Dynamic snapshot/attempt paths,
loopback port and a random capability-token identifier (never the token value) are canonicalized into
`profile_instance_sha256`. Validation
requires every instance permission/limit to be equal to or narrower than the approved template; no
dynamic value is part of the prior approval digest. Other operating systems return
`ISOLATION_UNAVAILABLE` in v1.

Before a real Agent starts, the worker runs non-model adversarial probes inside the exact boundary:

- read a known consumer file: allowed;
- create/modify/delete tracked, untracked and ignored consumer paths: denied;
- read a canary outside approved roots and a Supervisor canary: denied;
- write only the runtime attempt directory: allowed;
- outbound research request without gateway: denied;
- start and terminate a small child process: owned and observable.

Any mismatch returns `ISOLATION_UNAVAILABLE`. The probe is necessary but not the sole proof: the
default-deny Seatbelt policy, read-only snapshot, credential proxy, Codex's nested no-network tool
sandbox and continuous process/resource monitor enforce the boundary during the actual attempt. The
probe verifies an adapter-parent request succeeds but a representative command run through
`codex sandbox --sandbox-state-disable-network` has no proxy token and cannot open a network socket.
No prompt-only or post-hoc fallback exists.

## Consumer Integrity

Before and after execution, compute a deterministic inventory over every directory entry beneath the
consumer root (including ignored/untracked paths), file type, mode, size and content digest; symlinks
include target text and are never followed outside root. Repository identity and committed revision
must also match. A denied write attempt is still a policy violation and blocks readiness even when
the final inventory matches.

The runtime-owned analysis view may be a separate immutable clone/snapshot. It is never reused as an
implementation workspace.

## Resource Limits

| Resource | Limit | Enforcement |
|----------|-------|-------------|
| Agent attempt wall time | configured 1–30 minutes | monotonic deadline per attempt |
| Aggregate active execution | 3600 seconds | sum only while worker/proxy/gateway is active |
| Final structured result | 1 MiB | bounded file writer/stat before parse |
| stdout | 10 MiB | bounded stream; terminate on overflow |
| stderr | 10 MiB | bounded stream; terminate on overflow |
| Persisted records | 20 | reject/terminate before record 21 |
| Retained total | 20 MiB | aggregate before atomic promote |
| Temporary storage | 256 MiB | monitored attempt directory |
| Process tree | 64 processes | owned-tree sampling |
| Resident memory | 2 GiB aggregate | owned-tree sampling |
| Cleanup | 30 seconds | graceful stop then forced group kill |

The monitor starts before the adapter and continues through cleanup. A normal exit does not excuse a
limit breach. Human approval wait stops all processes and does not consume active time. Cleanup
deletes temporary content even after invalid output.

## Provider Transport vs. Research Network

`agent-runtime` authority binds the complete AgentDescriptor digest, executable digest, execution
template digest, selected model/provider profile, maximum phases/Agent attempts/provider HTTP
requests/cost and exact provider
control-plane origins. It includes only
the loopback-mediated provider channel required for model invocation. It does not permit Agent tools,
spawned commands or research gateway calls to access the internet. Authority is atomically rechecked
immediately before every Agent attempt; an already-started provider request may finish only within its
existing deadline, while any later attempt requires still-current authority.

`network-research` separately contains exact normalized HTTPS origins. Origin paths, query strings,
wildcards, IP literals, loopback, link-local, private, multicast and credential-bearing URLs are
invalid. DNS answers are checked before connection and after every redirect.

Network authority is atomically rechecked before every gateway request. Expiry prevents the next
request but does not relabel already fetched, integrity-checked historical sources.

Immediately before opening a socket, the gateway atomically publishes an
OutboundRequestReservation bound to the operation, query, exact recipe digest, origin and actual
network-authority epoch/receipt. It consumes one of 25 research requests even after a crash. The
gateway atomically adds a terminal OutboundRequestReceipt after completion/failure. An unreceipted
reservation recovers as `outcome-unknown`, is never resent and becomes a ResearchGap; remaining
recipes may continue only within the still-current epoch and remaining reservation budget. Each
reservation consumes the recipe's full response-byte ceiling before connect; a durable smaller receipt
releases the difference, while unknown/interrupted outcomes keep the full amount and 30-second active
reservation charged. Each successful ResearchSource binds the reservation/receipt ids and digests,
authority epoch, final URL and research-payload digest; mismatch blocks it from synthesis.

Research terminal state is staged, fsynced and atomically promoted as one same-filesystem directory.
Success contains receipt+ResearchSource+success manifest; known failure contains
receipt+ResearchGap+failure manifest. If the gateway crashes before `terminal` is visible, recovery
charges the full reservation and atomically publishes an outcome-unknown receipt+gap+failure manifest;
it removes incomplete staging and never repeats the request. A visible directory is accepted only when
the appropriate three records and all digests cross-validate.

### Research origins and authority subject

A `ResearchOriginCandidate` is closed: `{id, origin, source, source_sha256}`. `origin` is an exact
normalized HTTPS origin; `source` is `developer-input`, `signed-runtime-registry` or
`agent-suggestion`. In v1 the CLI
accepts developer origins explicitly and the built-in registry may contain only package-manager and
vendor documentation origins shipped in an integrity-checked registry artifact. Agent text, repository
prose and search results may create an `agent-suggestion` candidate for the pending packet, but it has
no authority until the developer approves the exact subject. An unknown origin must therefore be
explicitly selected as part of that foreground approval before any request starts.

The closed `NetworkResearchSubject` contains `schema_version`, digest-derived `id`, `operation_id`,
`query_set_sha256`, the ordered ResearchQuery ArtifactRef, ordered ResearchOriginCandidates, maximum
queries/sources/requests/redirects/response bytes/total bytes/request seconds, and reversibility exactly
`revocable-before-next-request`. No additional fields are accepted. The approval view renders every
query and origin. The operation journal may attach multiple signed AuthorityRefs as epochs only when
they bind this byte-identical subject; every request/source records its epoch.

## Research Request

```json
{
  "schema_version": 1,
  "id": "research-query-...",
  "operation_id": "alignment-operation-...",
  "query": "runtime-constructed public search terms, max 512 characters",
  "origin_ids": ["approved-origin-id"],
  "purpose": "claim or decision id",
  "constructed_from": [{"artifact_id": "goal-...", "artifact_sha256": "...", "location": {"kind": "json", "pointer": "/goal/original"}}],
  "requests": [{
    "id": "research-request-...",
    "adapter": "exact-https-get-v1",
    "url": "https://approved.example/exact/path?q=encoded-public-terms",
    "origin_id": "approved-origin-id",
    "method": "GET",
    "header_profile": "public-text-v1",
    "body": null,
    "deadline_seconds": 30,
    "max_response_bytes": 2097152,
    "recipe_sha256": "64 lowercase hex"
  }],
  "max_sources": 5,
  "query_sha256": "64 lowercase hex"
}
```

The Agent proposes only a `purpose` and public topic identifiers. The runtime constructs `query`
from the original developer goal's public terms plus detected public dependency names/versions from
manifest fields; arbitrary repository prose, source fragments and paths cannot enter it. Execution is
not inferred from an origin: every request uses the versioned `exact-https-get-v1` recipe and an exact
URL/path/query, method GET, fixed public-text headers, null body, response/deadline limits. Exact URLs
come from a signed registry recipe or are explicitly developer-approved when Agent-suggested. The
complete query and recipes are shown in the network capability subject. A changed query/URL/recipe
requires a new authority. Known-secret
comparison and credential-pattern scanning are defense in depth, not the trust boundary.

## Research Result

Each successful source conforms to `ResearchSource` in `data-model.md`. HTML/script/style/active
content is converted to bounded plain text; control characters are removed. Excerpts are at most 8
KiB, at most five sources are stored per query, and aggregate gateway output counts toward attempt
limits.

## Operation Budget and Ownership

Plan, research, synthesis and validation belong to one AlignmentOperation and one aggregate monitor.
The operation permits at most 5 research queries, 5 sources per query, 25 HTTP requests total, 3
redirects per request, 2 MiB response body per request, 10 MiB research bytes total and 30 seconds per
request. These counts share the operation's 20 retained-record and 20 MiB retained-total ceilings;
when both cannot hold, the lower effective limit wins. The parent worker owns gateway sockets,
temporary bodies and proxy processes and applies the same 30-second cleanup deadline.

## Errors

| Code | Behavior |
|------|----------|
| `RESEARCH_NOT_AUTHORIZED` | Skip gateway; record missing research without fabricated source |
| `ORIGIN_NOT_ALLOWED` | Block request; record destination only after sanitization |
| `PRIVATE_DESTINATION` | Block before connection and on redirect/DNS change |
| `OUTBOUND_DATA_REJECTED` | Block query containing source/secret material |
| `RESEARCH_TIMEOUT` | Record source gap; do not retry more than once |
| `RESEARCH_CONFLICT` | Preserve both sources and mark material conflict when applicable |
| `RESEARCH_LIMIT` | Stop retrieval and retain bounded completed sources |

Research failure does not automatically fail local understanding, but any required unresolved gap
prevents a ready scope brief.
