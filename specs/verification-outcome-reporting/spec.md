# Verification Outcome Reporting

Status: Implemented
Version: 1.0
Last updated: 2026-08-31

## Problem

When `verify --execute --attest` fails, the failure receipt is valuable review evidence even though
it must never become passing evidence. The CLI previously threw before showing the receipt path,
forcing developers to search internal storage manually.

## Acceptance criteria

- A failed execution returns exit code 3 and always prints or returns its receipt.
- A requested passing attestation is reported as not issued with a machine-readable reason.
- A passing command for which no sealed driver exists is not misrepresented as attested and returns
  a distinct non-zero result.
- Existing passing unit-test evidence issuance remains unchanged.
