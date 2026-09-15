# Plan: Domain Knownness Summary

## Goal

Expose database, frontend, and backend as small numeric “known vs unknown” summaries, with a second level for the important subdomains inside each one, so the developer can assess the riskiest parts of a repo without reading every artifact.

## Implementation sketch

1. Derive per-domain and per-subdomain counts from the existing onboarding claim ledger.
2. Add the counts to the onboarding summary contract.
3. Surface the counts in the text brief and the Alignment Brief.
4. Add regression tests for the new summary field and its rendering.

## Exit criteria

- The three core domains show known/unknown/conflict counts.
- The summary stays compact.
- Existing onboarding, alignment, and review tests remain green.
