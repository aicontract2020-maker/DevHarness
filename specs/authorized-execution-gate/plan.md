# Technical Plan: Authorized Execution Gate

1. Add a pure policy that maps plan command/service signals to stable capability IDs and evaluates a
   current authorization view.
2. Require `--run` for public `verify --execute`, load the current capability view and enforce the
   policy before calling the executor.
3. Make missing project declaration outrank new capability requests after pending decisions resolve.
4. Preserve safe verification previews and direct runtime unit interfaces.

| AC | Components |
|----|------------|
| AC-1, AC-5 | CLI execution boundary |
| AC-2, AC-3 | Pure execution-authority policy |
| AC-4 | Capability status next-action projection |

High risk: an incomplete inference could overgrant authority. Mitigation: requirements only add
restrictions; unknown database, credential and destructive operations remain unsupported rather
than inferred.

