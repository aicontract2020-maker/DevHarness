# Contract: Decision Surface

## Authority

Detailed artifacts, goal state, gate decisions, criteria, evidence, and review verdicts remain authoritative. An interaction packet is a revision-bound derived view for a human; approving it approves the artifact hash named by the gate, not unrecorded prose.

## Four packet kinds

- `alignment-brief`: the single Gate 1 review surface.
- `decision-queue`: one to three material exceptions requiring authority or product judgment.
- `progress-pulse`: a no-action status view derived from current state and artifacts.
- `delivery-brief`: the single Gate 2 review surface.

## Attention rule

Human attention is required when a choice has material outcome impact and unresolved uncertainty, especially when it is costly to reverse or crosses security, privacy, destructive-action, financial, external-authority, or approved-scope boundaries.

Repository-discoverable facts and low-risk reversible implementation choices do not enter the queue. They are resolved autonomously and recorded in detailed artifacts.

## Compression rule

Each packet reports how many source artifacts and decision-relevant items it summarized, surfaced, and omitted. Every surfaced item maps to one or more source artifacts. Omission is allowed only for non-blocking detail available through progressive disclosure.

## Question budget

A packet contains no more than three unresolved decisions. If more remain, the runtime must research further, group dependent choices, or propose milestone decomposition. It must not silently truncate the queue.

## Failure rule

Blocking uncertainty, failed acceptance criteria, unresolved blocking review findings, and missing authority cannot appear under an informational or ready verdict.

