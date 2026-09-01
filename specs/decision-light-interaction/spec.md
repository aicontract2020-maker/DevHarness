# Specification: Decision-light developer interaction

Status: Approved by user direction
Version: 1.0.0
Mode: Full

## Overview

DevHarness must preserve rich engineering artifacts without making the developer review them all. The normal goal workflow exposes four compact, traceable interaction packets and interrupts the developer only for two gates or material exceptions.

## User Story

As a developer delegating a software goal, I want to review conclusions, decisions, progress, and proof in a few bounded views so that I can trust and control the work without supervising agent files or transcripts.

## Boundaries

Always:

- Store complete source artifacts for recovery and audit.
- Show a bounded derived packet for each developer interaction.
- Separate confirmed claims from unresolved claims.
- Map every surfaced decision-relevant claim to source artifacts.
- Recommend an action when human attention is required.

Ask first:

- User-visible outcome or approved scope changes.
- Security, privacy, destructive, financial, external-authority, or costly-to-reverse decisions.
- Material ambiguity that repository research and safe public research cannot resolve.

Never:

- Ask the developer for facts discoverable from the repository or configured tools.
- Require reading raw artifacts to approve a normal gate.
- Present private model chain-of-thought.
- Hide unresolved blocking items behind a positive summary.

## Acceptance Criteria

### AC-1: Four bounded interaction packets [MUST]

The interaction contract supports `alignment-brief`, `decision-queue`, `progress-pulse`, and `delivery-brief`, with common status, attention, action, compression, and traceability fields.

### AC-2: Gate 1 approves shared understanding [MUST]

The scope gate is presented as an Alignment Brief covering refined outcome, user-visible changes, non-goals, material findings and assumptions, acceptance summary, risks, and unresolved decisions.

### AC-3: Review by exception [MUST]

Between human gates, low-risk reversible choices proceed autonomously and only material exceptions enter the Decision Queue.

### AC-4: Bounded question batches [MUST]

A decision packet carries at most three unresolved decisions. Larger ambiguity sets must be researched further or proposed as milestone decomposition rather than emitted as a questionnaire.

### AC-5: Progressive disclosure [MUST]

The default view is a concise verdict and required action; source artifacts and evidence remain available through references without being required reading.

### AC-6: Summary traceability [MUST]

Every decision-relevant surfaced item references at least one source artifact, and every packet reports source, surfaced, and omitted item counts.

### AC-7: Delivery approval is criterion-oriented [MUST]

The Delivery Brief summarizes acceptance verdicts, independent review, significant changes, remaining risks, and developer actions without requiring a full diff or log review.

### AC-8: Developer attention is observable [SHOULD]

Runtime events distinguish packet publication, attention requests, and attention resolution so progress interfaces can show a single attention queue.

### AC-E1: Unresolved blockers cannot be compressed away [MUST]

If any blocking issue remains, the packet verdict is `action-required`, `blocked`, or `failed`, and the attention count is non-zero where human authority can resolve it.

### AC-E2: Invalid oversized decision packets are rejected [MUST]

Contract validation rejects more than three decisions rather than relying on an interface to truncate them.

## Out of Scope

- Implementing `devharness goal` orchestration in this change.
- Building a graphical dashboard.
- Choosing notification transports.
- Automatic merge or removal of either default human gate.

## Non-Functional Requirements

- Interaction contracts remain agent-, UI-, and platform-agnostic.
- Packets are derived from durable state and artifacts, never chat memory.
- Schema validation is deterministic and dependency-free.

