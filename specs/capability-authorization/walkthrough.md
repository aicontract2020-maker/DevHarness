# Walkthrough: Capability Authorization Checkpoint

## 1. Developer selects one named capability

`request-capability --run ID --capability ID` accepts no subject hash. The CLI resolves the current
external Goal Run and delegates to the authorization service.

## 2. Current source is proved intact

The Goal Run store loads only the source declared by the current interaction packet, rejects unsafe
IDs and recomputes its canonical SHA-256 before returning the onboarding plan.

## 3. Approval subject is derived

The authorization service selects the exact capability object, hashes all of its bounded fields and
creates a Supervisor-signed request bound to repository, run, revision, nonce and expiry.

## 4. Review status is projected

The service joins the current capability list with verified requests and receipts. It reports one of
six explicit states; only a current `approved` receipt represents authority.

## 5. Developer sees the complete boundary

The read-only review endpoint and page show operation, target, scope, risk, authority, reason, hash,
status counts and one next command. No browser action can write an approval.

## 6. Foreground decision is informed and immutable

Before accepting the exact phrase, the Supervisor prompt resolves the current capability again and
prints every bounded field. The existing signed immutable receipt machinery records the decision.

## Not handled here

- Mapping an approval to a project-harness driver.
- Starting browsers, services, containers or disposable databases.
- Independent human authentication beyond foreground TTY presence.

## Unrequested behavior

None. The review API remains GET-only and no approved capability is executed in this milestone.

