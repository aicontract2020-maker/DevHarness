# Validation: Verification Outcome Reporting

Status: Passed
Validated: 2026-08-31

- The formatter test requires both human-readable and JSON output to retain the failed receipt.
- Targeted CLI regression: 14/14 passed.
- Full DevHarness regression: 142/142 passed.
- The formatter preserves the failed receipt in both text and JSON and gives the missing passing
  attestation a stable `execution-failed` reason.
