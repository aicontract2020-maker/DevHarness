# Tasks: Supervisor Provenance

- [x] **SP-001 [M]** Add failing schema/canonical/signature/forgery tests for AC-SP-1–3,5–6,8.
- [x] **SP-002 [M]** Implement supervisor identity and immutable signed artifact store.
- [x] **SP-003 [M]** Implement sealed command-test driver and signed evidence manifest issuance.
- [x] **SP-004 [M]** Implement approval request + foreground decision receipt issuance.
- [x] **SP-005 [M]** Migrate trusted context, doctor and state gates to verified supervisor artifacts.
- [x] **SP-006 [M]** Add CLI/status UX without non-interactive approval bypass.
- [x] **SP-007 [M]** Dogfood read-only example-consumer flow, adversarial review, validation and walkthrough.

Dependencies: SP-001 -> SP-002 -> {SP-003, SP-004} -> SP-005 -> SP-006 -> SP-007.
SP-003 and SP-004 may run in parallel because their writers and schemas are separate.
