# Research: Decision-light developer interaction

## Problem Summary

DevHarness already preserves detailed engineering artifacts, but the planned goal workflow does not yet define a compact developer-facing decision surface. The missing boundary is between durable machine/audit context and the small amount of information a developer must review.

## Relevant Files

| File | Current responsibility |
|------|------------------------|
| `docs/product.md:23` | Defines the job as letting developers handle only meaningful decisions and exceptions. |
| `docs/product.md:27` | Defines scope and delivery as the two default human gates. |
| `docs/product.md:55` | Lists inspectable artifacts, but does not define how they are compressed for a human. |
| `docs/architecture.md:37` | Defines the durable goal state machine. |
| `docs/architecture.md:71` | Defines the detailed artifact tree stored for a goal. |
| `docs/mvp.md:51` | Places clarification, scope approval, progress, and delivery in Milestone 2. |
| `packages/schema/schemas/v1/run-event.schema.json:25` | Records questions and artifacts, but not developer-attention or summary-view events. |
| `packages/schema/src/validator.mjs:174` | Enforces minimum array size but not `maxItems`, so it cannot enforce a question batch budget. |

## Key Findings

### F-1: The product promise already requires low-attention interaction

The core job explicitly says the developer should handle only meaningful decisions and exceptions (`docs/product.md:23`). The interaction model is therefore a reliability requirement, not later UI polish.

### F-2: Two gates exist, but their review payload is undefined

Scope and delivery approval list the underlying information (`docs/product.md:27`), while the architecture exposes a large artifact tree (`docs/architecture.md:71`). No contract defines a bounded brief, the default detail level, or how a summary traces back to those artifacts.

### F-3: Observable work can still overwhelm the developer

The current product definition correctly rejects private chain-of-thought and lists inspectable outputs (`docs/product.md:55`). Without progressive disclosure, that list can become a requirement to inspect every file, defeating the primary job.

### F-4: Question events lack an interruption policy

The event contract records `question.asked` and `question.answered` (`packages/schema/schemas/v1/run-event.schema.json:25`) but cannot distinguish a discoverable fact from a material product decision. The runtime needs an attention policy based on outcome impact, uncertainty, and reversibility.

### F-5: The planned runtime needs a portable interaction contract

The CLI, a future dashboard, and different agent adapters must show the same approved understanding and evidence. A versioned interaction-packet contract prevents each interface or agent from inventing a different summary.

## Existing Constraints Discovered

- Private chain-of-thought is never a product artifact.
- The default workflow retains exactly two mandatory human gates.
- Detailed artifacts remain durable and externally stored.
- Every trusted claim must remain traceable to structured artifacts or evidence.
- Low-risk reversible implementation choices may be autonomous; material scope, security, data, authority, or irreversible choices require attention.

## Decision

Introduce a Decision Surface with four bounded packet kinds: Alignment Brief, Decision Queue, Progress Pulse, and Delivery Brief. Packets are derived views, never sources of truth. Each surfaced claim maps to source artifact references, and the packet states how many source and surfaced items were compressed.

## Not Investigated

- Visual dashboard layout and notification channels.
- Agent-specific summarization prompting.
- Hosted collaboration or organization-level approval policies.

