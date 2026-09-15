# Validation: Repository Understanding Digest

## Required checks

- Schema validation for the onboarding plan still passes.
- The onboarding brief contains deterministic claim-status counts.
- The brief surfaces conflicts before ordinary warnings.
- Database-related gaps are listed before lower-priority gaps when database signals exist.
- Output remains read-only and does not execute any consumer command.

## Suggested tests

- One repository fixture with web and database signals.
- One fixture with a deliberate conflict or unverified gap.
- One assertion that the summary counts are stable and revision-bound.

## Human review

The developer should be able to confirm the improvement by reading only the first screen of the brief and, if needed, the matching JSON summary.
