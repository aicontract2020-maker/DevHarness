# Developer interaction model

## Outcome

DevHarness may generate many detailed artifacts, but a developer should not have to read them all to trust a normal goal run. Detailed artifacts are for agents, recovery, audit, and drill-down. The default human interface is a small Decision Surface derived from those artifacts.

The ordinary developer journey has four surfaces:

```text
Goal
  -> Alignment Brief        human Gate 1
  -> autonomous execution
       -> Progress Pulse    no action
       -> Decision Queue    material exceptions only
  -> Delivery Brief         human Gate 2
```

The target is fewer than ten minutes of developer attention for a normal bounded goal, excluding optional code or evidence inspection.

## Artifact-rich backend, decision-light frontend

The runtime keeps complete research, requirements, design, tasks, events, logs, evidence, findings, and repair history. These files are not a developer inbox.

Every user-facing interaction is a bounded packet with:

- A verdict first.
- One clear next action.
- Confirmed facts separated from items that still require verification.
- At most three unresolved decisions.
- Links to source artifacts and evidence.
- Counts describing how much information was compressed and omitted.

A developer can drill down, but normal approval cannot depend on reading every raw artifact.

## 1. Alignment Brief

The Alignment Brief is the only default review surface for Gate 1. It answers:

- What user outcome does DevHarness believe was requested?
- What user-visible behavior will change?
- What explicitly will not change?
- What did repository and external research establish?
- Which claims remain assumptions?
- What are the top-level acceptance criteria and proof methods?
- What risks or external dependencies matter?
- Which decisions still require developer authority?

Gate 1 is therefore an **understanding and acceptance approval**, not a request to approve a folder of generated specifications.

The developer can approve, request a correction, answer the batched decisions, or inspect supporting artifacts. Approval records the hash of the authoritative artifact set represented by the brief.

## 2. Decision Queue

Between the two gates, the runtime works autonomously and interrupts only for material exceptions.

Human attention is appropriate when unresolved uncertainty combines with material impact, especially when a choice:

- Changes the approved user outcome, scope, or acceptance criteria.
- Crosses a security, privacy, destructive-action, financial, or external-authority boundary.
- Is costly or impossible to reverse.
- Requires product judgment between multiple valid outcomes.
- Cannot be resolved from repository inspection, configured tools, safe research, or existing policy.
- Exhausts a repair, cost, time, or scope budget.

The runtime does not ask about repository-discoverable facts, naming, file placement, test organization, or other low-risk reversible implementation choices. It makes those decisions, records them, and continues.

Each Decision Queue packet contains one to three related decisions. Every decision includes why it is being asked now, affected outcomes, a recommendation, and two or three concrete options with tradeoffs. If more than three unresolved decisions remain, the runtime researches further, groups dependent choices, or proposes smaller milestones. It does not emit a questionnaire or silently truncate the queue.

## 3. Progress Pulse

Progress is a compact projection over durable state and artifacts, not a stream of agent narration. It shows:

- Current phase and next step.
- Tasks completed, active, blocked, and remaining.
- Acceptance criteria proved, failed, blocked, and pending.
- Whether risk or approved scope changed.
- Repair budget consumption.
- Current developer-attention count.

A healthy Progress Pulse requires no response. Detailed agent events and files remain available through drill-down.

## 4. Delivery Brief

The Delivery Brief is the only default review surface for Gate 2. It presents:

- The implemented user outcome.
- Criterion-level pass, fail, blocked, and not-applicable counts.
- Evidence coverage and links.
- Test and real-behavior verification summaries.
- Independent review result and resolved findings.
- Significant implementation changes.
- Remaining risks, limitations, and follow-up work.
- Pull request or final diff reference.

The developer can approve delivery, request repair, inspect a functional demonstration, inspect high-risk changes, or open complete evidence. A failed or blocked criterion can never be hidden behind an overall ready verdict.

## Progressive disclosure

Every surface has three layers:

1. **Glance:** verdict, phase, attention count, acceptance coverage, risk, and next action.
2. **Decision:** the facts, options, recommendation, and consequences required to act.
3. **Audit:** full source artifacts, events, logs, evidence, reviews, and diff.

All layers are projections of the same structured contracts. A UI may change presentation, but it may not invent, omit, or override authority.

## Trusting the summary

Replacing detailed files with an untraceable agent summary would only move the trust problem. DevHarness therefore requires:

- Every surfaced item has a stable ID.
- Every decision-relevant item references one or more checksummed source artifacts.
- The packet is bound to the current goal run and Git revision.
- The packet reports source-artifact, surfaced-item, and omitted-item counts.
- Blocking uncertainty uses `action-required`, `blocked`, or `failed`, never `informational` or `ready`.
- Gate approval records the represented authoritative artifact hash.
- Independent critics may challenge research, design, verification, and review before the packet reaches the developer.

The packet is a read model. Goal state, source artifacts, gate decisions, acceptance verdicts, evidence, and review verdicts remain authoritative.

## Quantitative review and proof coverage

The Decision Surface includes a reproducible Review Scorecard. It reports a hard-gate
verdict before a numeric proof-coverage score, so a high score can never hide an unproved
`[MUST]` criterion, a critical unknown, stale evidence, or an open security or data-integrity
finding.

The score is derived from visible counts for acceptance definition, system understanding,
delivery traceability, verification sufficiency, and independent review closure. Critical
claims are graded by evidence level: unchecked claim, cited inspection, executed automated
test, observed real behavior, or production-like system proof. Developers normally review
only exceptions, but can trace, inspect, replay, or view significant changes for any
criterion.

The normative scoring rules and reusable worksheet are defined in
[`review-scorecard.md`](review-scorecard.md). The score measures proof coverage; it is not an
agent confidence score and cannot by itself authorize delivery.

## Acceptance hierarchy

Top-level acceptance criteria stay short and user-oriented. Detailed subcriteria and test cases remain underneath:

```text
Goal
  -> requirement
      -> top-level acceptance criterion
          -> implementation tasks
          -> proof recipe
          -> evidence records
```

The Alignment and Delivery Briefs show the top level. Drill-down reveals subcriteria, tasks, and individual evidence records. This keeps the review readable without weakening traceability.

## Interaction packet contract

`packages/schema/schemas/v1/interaction-packet.schema.json` is portable across CLI, dashboard, and agent adapters. It defines the four packet kinds, verdicts, attention reasons, bounded decisions, actions, traceability, and compression counts.

Packet publication and attention lifecycle are recorded as runtime events:

- `interaction.published`
- `attention.requested`
- `attention.resolved`

Attention is orthogonal to most goal states. The runtime adds a blocker or waits at a human gate only when policy says work cannot continue safely.

## Product success measures

For a bounded goal, DevHarness should be able to report:

- Developer attention time.
- Number of questions asked and how many were repository-discoverable in hindsight.
- Number of Decision Queue interruptions.
- Percentage of runs completed with only the two default gates.
- Packet-to-artifact traceability coverage.
- Scope changes discovered after Gate 1.
- Delivery rejections caused by misunderstanding versus implementation failure.

These metrics test whether the product reduces supervision while preserving control. Artifact count is not a success metric.
