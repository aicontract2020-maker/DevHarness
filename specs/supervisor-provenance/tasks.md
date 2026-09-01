# Tasks: Supervisor Provenance

- [ ] **SP-001 [M]** Add failing schema/canonical/signature/forgery tests for AC-SP-1–3,5–6,8. *(in progress; adversarial API-boundary tests remain)*
- [ ] **SP-002 [M]** Implement supervisor identity and immutable signed artifact store. *(in progress; fixed root and immutable blobs landed, permission hardening remains)*
- [ ] **SP-003 [M]** Implement sealed command-test driver and signed evidence manifest issuance. *(in progress; execution ownership and generic signer removal remain)*
- [ ] **SP-004 [M]** Implement approval request + foreground decision receipt issuance. *(in progress; independent human authentication and generic signer removal remain)*
- [ ] **SP-005 [M]** Migrate trusted context, doctor and state gates to verified supervisor artifacts. *(in progress; package layering and run-bound policy cleanup remain)*
- [ ] **SP-006 [M]** Add CLI/status UX without non-interactive approval bypass. *(in progress; reviewable subject brief and status UX remain)*
- [ ] **SP-007 [M]** Dogfood read-only AIedu flow, adversarial review, validation and walkthrough.

Dependencies: SP-001 -> SP-002 -> {SP-003, SP-004} -> SP-005 -> SP-006 -> SP-007.
SP-003 and SP-004 may run in parallel because their writers and schemas are separate.
