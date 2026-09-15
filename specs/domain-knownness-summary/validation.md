# Validation: Domain Knownness Summary

## Checks

- Onboarding plan schema accepts the new domain-knownness field.
- The text brief includes database, frontend, and backend known/unknown counts.
- The text brief also includes the database schema/migrations/constraints/queries/ownership layer and the frontend/backend subdomains.
- The Alignment Brief surfaces the same counts.
- Counts are deterministic across repeated runs.

## Suggested tests

- One repository fixture with database and web signals.
- One manual alignment fixture to ensure the packet can carry the new summary.
- One schema validation test for the new summary structure.
