# Contract: Advance CLI

## `devharness advance --run ID [--repo PATH] [--data-dir PATH] [--format text|json]`

Accepts only a stored `received` run whose repository identity and committed revision match the
current clean repository. Performs static discovery only. Publishes a checkpoint ending in
`clarifying` and returns the run, current interaction packet, scorecard, external path and one next
action. A non-ready packet returns exit code 2.

Errors before publication: missing/invalid run, different repository, changed revision, dirty tree,
non-`received` state, invalid contracts or concurrent advance.
