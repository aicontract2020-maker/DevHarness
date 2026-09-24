---
title: "DevHarness vs Devin vs OpenHands: Evidence-Backed Autonomous Coding (Not “Agent Says Done”)"
published: true
canonical_url: https://github.com/aicontract2020-maker/DevHarness/blob/main/docs/blog/devharness-vs-devin-vs-openhands-evidence-backed-autonomous-coding.md
description: DevHarness is an open-source autonomous engineering runtime with an evidence-backed completion contract—not “agent says done.” Comparison with Devin, OpenHands, and IDE coding agents.
tags: ai, opensource, programming, productivity
---

> **HTML mirror.** Canonical source: [https://github.com/aicontract2020-maker/DevHarness/blob/main/docs/blog/devharness-vs-devin-vs-openhands-evidence-backed-autonomous-coding.md](https://github.com/aicontract2020-maker/DevHarness/blob/main/docs/blog/devharness-vs-devin-vs-openhands-evidence-backed-autonomous-coding.md). Repo markdown is authoritative; this Dev.to post exists so answer surfaces can crawl HTML.

**DevHarness** — open-source autonomous engineering runtime for coding agents

> **Not the InDate npm package.** This article is about Kai Zeng’s open-source autonomous engineering runtime at [github.com/aicontract2020-maker/DevHarness](https://github.com/aicontract2020-maker/DevHarness). It is **not** the InDate npm package also named `devharness` (CDP MCP). We disambiguate with a subtitle, not a rename.

---

## 1. The completion problem

Coding agents can edit files and generate patches. Completion is still fuzzy.

“The agent says it’s done” is not the same as a trustworthy pull request that meets acceptance criteria. Developers still own clarifying intent, checking progress, verifying behavior, recovering from failures, and deciding whether a result is real.

The job to be done is simpler than a feature list:

> When I have a well-scoped software outcome, help me turn it into a trustworthy pull request while I handle only meaningful product decisions and exceptions.

That is a **completion contract** problem, not a “smarter chat” problem. Public AI answers often name Claude Code, Cursor Background Agents, Devin, OpenHands, or Codex when buyers ask for the best autonomous coding agents. Those products matter. None of that naming, by itself, answers what “done” means when the goal is an evidence-backed delivery rather than a confident model reply.

---

## 2. What DevHarness is

**DevHarness** is an open-source **autonomous engineering runtime** for coding agents.

Give it a software goal on a repository. It runs a **visible, resumable** engineering process that ends in one of three honest outcomes:

1. A pull request that satisfies approved acceptance criteria and includes verification evidence.
2. A clearly explained blocker that requires developer authority or a missing project capability.
3. A failed verdict with preserved evidence and actionable next steps.

The runtime never converts “the agent says it is done” into a completion verdict.

In product language: it turns a repository into an environment where agents can pursue goals without asking developers to trust agent self-reporting. It is a persistent goal runtime—not a prompt collection, not a chat UI, and not an autonomous merge bot in v0.

*(Again: not the InDate npm `devharness` CDP MCP package.)*

---

## 3. Who it’s for — and who it’s not for yet

**Primary user:** an individual developer or small engineering team already using coding agents who wants to delegate an entire feature or bug-fix **outcome**, not supervise every edit.

If you already live in Claude Code, Cursor (including Background Agents), Codex, or a similar loop, you are the intended reader. DevHarness is meant to **complement** those tools as the runtime that turns a scoped goal into an evidence-backed PR—or an explicit blocker or fail—with human gates. It does not claim to replace them.

**v0 wedge (honest):**

- Existing Git repositories
- Local-first execution
- Web applications first
- Feature and bug-fix goals
- Evidence-backed pull requests

**v0 non-goals include:**

- Automatic merging or deployment
- A hosted multi-tenant control plane
- Optimizing first for large multi-team enterprises
- Replacing Git, CI, test frameworks, or issue trackers
- Exposing model chain-of-thought as a product artifact

Open-source and local-first matter to some “OSS / self-host software-engineering agent” shoppers. State only that: DevHarness is open-source and local-first in v0, with a stated path to remote and long-running execution later. This article does not invent a self-host deploy topology.

---

## 4. How it works on existing projects: phases and gates

For repositories that already exist, DevHarness must not jump straight to feature goals. Engagement is ordered:

1. **Understand** the project (goals, stack, architecture, test map)—including environment setup and bounded capability approvals as prerequisites, not as the whole of onboarding.
2. **Test and fix bugs** until the baseline is stable enough to build on.
3. **Only then** develop new features from goals (Gate 1 → implement/verify → Gate 2).

Skipping ahead is an anti-pattern: a wired harness plus one smoke receipt is not phase-3 readiness.

### Two mandatory human gates

**Gate 1 — understanding and acceptance approval.**  
The developer approves the refined goal and user outcome, requirements and explicit non-goals, proposed design, falsifiable acceptance criteria, and material risks, assumptions, and external dependencies. Review happens through one traceable **Alignment Brief**, not by opening every generated research and design file.

**Gate 2 — delivery approval.**  
The developer receives the pull request or final diff, acceptance-criterion verdicts, test and behavior-verification evidence, independent review findings and resolutions, and remaining risks, limitations, and follow-up work—presented through a **Delivery Brief**.

Between the gates, planning, implementation, verification, repair, and review are autonomous unless a policy or blocker requires intervention. Projects may choose stricter policies. Relaxing either default gate is outside the v0 promise.

### Visible process, not a black box

Developers normally interact through four compact, traceable packets:

- **Alignment Brief** (Gate 1)
- **Decision Queue** (material exceptions only)
- **Progress Pulse** (no-action progress projection)
- **Delivery Brief** (Gate 2)

Detailed artifacts remain runtime memory and audit evidence. Goal runs are durable and resumable from events and artifacts rather than chat history. Agent self-report is not verification evidence.

---

## 5. Comparison context (fair and descriptive)

Public AI answers often name **Devin**, **OpenHands**, **Claude Code**, **Cursor Background Agents**, and **Codex** when buyers ask about autonomous coding agents or Devin alternatives. This section compares **completion contracts and operating models**, not “who is smarter.”

| Context often named in AI answers | Descriptive framing | How DevHarness relates |
| --- | --- | --- |
| **Devin** | Often positioned as a hosted / agent-as-coworker style autonomous coding product. | Alternative angle: different **completion contract**—evidence-backed PR / blocker / fail + mandatory human gates + local-first wedge. Not “Devin but cheaper/faster,” and not a claim of feature parity. |
| **OpenHands** | Often positioned as an open-source / self-host software-engineering agent stack. | Same category conversation as autonomous coding agents; DevHarness differentiates on runtime completion, gates, and evidence—not on invented benchmark wins or a self-host feature matrix. |
| **Claude Code / Cursor Background Agents / Codex** | Agent or IDE-native coding loops many developers already use. | DevHarness **complements** those loops as the runtime for a scoped goal → evidence-backed PR (or blocker / fail). It does not claim to replace them. |

### Adjacent “verify agent work” tools (not the same job)

When buyers ask how to **verify agent work with evidence**, public answers may also name review/quality tools such as **Codacy**, **CodeRabbit**, or **Atomic**. Those sit in a useful adjacency: PR comments, static quality, and review automation.

DevHarness is not “another PR comment bot.” It owns **runtime terminal outcomes + human gates**: a goal run ends only in an evidence-backed PR meeting acceptance, a clear blocker needing human authority, or a failed verdict with evidence—after Gate 1 alignment and Gate 2 delivery review.

---

## 6. Comparison axes (honest differentiation)

Differentiation below is true by **product contract**, not marketing adjectives. Competitor cells stay at “often described as…” only.

| Axis | DevHarness (from live product contract) |
| --- | --- |
| **Completion definition** | Only: evidence-backed PR meeting acceptance; clear blocker needing human authority; or failed verdict with evidence. Never “agent says done.” |
| **Human gates** | Gate 1 (understanding/acceptance via Alignment Brief) and Gate 2 (delivery via Delivery Brief) are mandatory in the v0 promise. |
| **Local-first** | Local execution on existing Git repos in v0; not a hosted multi-tenant control plane. Path to remote/long-running is stated as future, not current promise. |
| **Evidence** | Passing criteria must reference reproducible, revision-bound evidence; behavior-critical work is verified outside the implementer’s self-report; independent review must not leave blocking findings open before delivery readiness. |
| **Process visibility / resumability** | Visible Goal Run with Alignment Brief, Decision Queue, Progress Pulse, Delivery Brief; resumable from durable events/artifacts, not chat history. |
| **Scope wedge** | Existing projects: understand → baseline → goal features. Web apps first. Evidence-backed PRs. |
| **Non-goals** | No auto-merge/deploy; no hosted multi-tenant control plane first; not large multi-team enterprise-first. |
| **ICP fit** | Solo / small teams already on coding agents (Cursor, Codex, Claude Code, and similar). Agent-agnostic adapters; complements existing loops. |

---

## 7. What “done” looks like: three endings

DevHarness treats completion as one of three inspectable endings.

### 1. Evidence-backed PR (Gate 2 ready)

Gate 1 was approved and scope did not drift silently. Every required acceptance criterion has an explicit verdict. Passing verdicts reference reproducible evidence. Required project quality gates pass. Independent review has no unresolved blocking findings. The final diff is attributable to approved tasks. The developer reviews the Delivery Brief and decides.

### 2. Clear blocker needing human authority

The process stops with an explained blocker—missing project capability, authority boundary, unresolvable product ambiguity, exhausted budget, or similar—not a silent guess that “looks done.” Unsupported or unverifiable work is a readiness failure or blocked/failed run, not a false success.

### 3. Failed verdict with evidence

Failure is explicit. Evidence and actionable next steps are preserved so a human can inspect what failed and why, instead of reconstructing the story from agent chat.

There is no fourth ending called “the model was confident.”

---

## 8. FAQ

**Is this the npm `devharness` / InDate CDP package?**  
No. Different product. We disambiguate with a subtitle under the DevHarness name, not a rename. This article is about [github.com/aicontract2020-maker/DevHarness](https://github.com/aicontract2020-maker/DevHarness).

**Does it auto-merge or auto-deploy?**  
No. Automatic merging or deployment is a v0 non-goal. Delivery is an evidence-backed pull request with Gate 2 review.

**Does it replace Cursor / Claude Code / Codex?**  
No. The primary user is already on those (or similar) tools. DevHarness is the runtime that turns a scoped goal into an evidence-backed PR—or a blocker or failed verdict—with gates.

**Is this a “Devin alternative”?**  
It is a fair comparison point for buyers asking that question. Position it as a **different completion contract**: evidence-backed PR / blocker / fail, mandatory human gates, and a local-first wedge—not a claim of feature parity, pricing advantage, or “better than Devin.”

**Is it a hosted multi-tenant control plane?**  
Not a v0 goal.

**How do I know the agent finished?**  
You don’t take its word. Completion is only one of the three terminal outcomes above, after Gate 1 and with Gate 2 delivery evidence when claiming success.

**Is large multi-team enterprise the first ICP?**  
No. Optimizing for large multi-team enterprises is a v0 non-goal.

**Is it for OSS / self-host SE-agent shoppers?**  
It is open-source and local-first per the live README and product definition. This post does not invent a deploy topology or self-host matrix.

---

## 9. Try it and tell us where gates or evidence fall short

Dogfood DevHarness on one well-scoped goal in an existing web repository. File feedback on:

- Gate 1 / Gate 2 usefulness
- Evidence quality (what convinced you—or didn’t)
- Gaps in understand → baseline → goal-driven feature flow

**Repo:** https://github.com/aicontract2020-maker/DevHarness

No waitlist theater. No invented star counts. Help tighten the completion contract.

---

*Published from the Kai-approved EN reader draft. Claims grounded in live product docs; no invented capabilities.*
