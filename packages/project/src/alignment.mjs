import { createRunEvent } from "../../core/src/goal-run.mjs";
import { evaluateInteractionPacket } from "../../core/src/interaction-policy.mjs";
import { assertContract } from "./contracts.mjs";
import { hashContract } from "./harness.mjs";
import { summarizeGoalPlan } from "./onboard.mjs";
import { createValidatedUnderstandingBaselineFromOnboardingPlan } from "./understanding-baseline.mjs";

const PROVED_STATUSES = new Set(["code-confirmed", "test-confirmed", "runtime-observed"]);

function artifact(id, kind, value) {
  return { id, kind, value, sha256: hashContract(value) };
}

function item(id, text, confidence, severity, sourceRefs, basis = null) {
  return { id, text, confidence, severity, source_refs: sourceRefs, ...(basis && basis.length > 0 ? { basis } : {}) };
}

function transition(runId, sequence, at, from, to) {
  return createRunEvent({ runId, sequence, at, type: "state.transitioned", data: { from, to } });
}

export async function createGoalUnderstandingCheckpoint({ run, snapshot, onboardingPlan, generatedAt = new Date().toISOString() }) {
  await assertContract("goal-run", run);
  await assertContract("repository-snapshot", snapshot);
  await assertContract("onboarding-plan", onboardingPlan);
  if (run.state !== "received") throw new Error("Static understanding can advance only a received Goal Run.");
  if (snapshot.repository.identity !== run.repository.identity || onboardingPlan.repository_identity !== run.repository.identity) {
    throw new Error("Repository identity does not match the Goal Run.");
  }
  if (snapshot.repository.git.dirty || !snapshot.repository.git.head_sha) {
    throw new Error("Understanding requires a clean committed repository snapshot.");
  }
  if (snapshot.repository.git.head_sha !== run.current_head_sha || onboardingPlan.commit_sha !== run.current_head_sha) {
    throw new Error("Repository revision does not match the Goal Run revision.");
  }

  const understandingBaseline = await createValidatedUnderstandingBaselineFromOnboardingPlan(onboardingPlan, {
    capturedAt: generatedAt
  });
  const artifacts = [
    artifact("artifact-goal-input", "goal-input", { run_id: run.id, original_goal: run.goal.original, scope_version: run.goal.scope_version }),
    artifact("artifact-repository-snapshot", "repository-snapshot", snapshot),
    artifact("artifact-onboarding-plan", "onboarding-plan", onboardingPlan),
    artifact("artifact-understanding-baseline", "repository-understanding-baseline", understandingBaseline)
  ];
  const source = Object.fromEntries(artifacts.map((entry) => [entry.id, entry]));
  const confirmedClaims = onboardingPlan.claims.filter((claim) => PROVED_STATUSES.has(claim.status));
  const understandingSummary = onboardingPlan.summary ?? {
    total_claims: onboardingPlan.claims.length,
    proved_claims: confirmedClaims.length,
    unresolved_claims: onboardingPlan.claims.filter((claim) => ["conflict", "unverified", "not-covered"].includes(claim.status)).length,
    conflict_claims: onboardingPlan.claims.filter((claim) => claim.status === "conflict").length,
    domain_knownness: Object.fromEntries(["database", "frontend", "backend"].map((domain) => {
      const domainClaims = onboardingPlan.claims.filter((claim) => claim.domain === domain);
      return [domain, {
        total_claims: domainClaims.length,
        known_claims: domainClaims.filter((claim) => ["code-confirmed", "test-confirmed", "runtime-observed", "documented"].includes(claim.status)).length,
        unknown_claims: domainClaims.filter((claim) => ["detected", "unverified", "not-covered"].includes(claim.status)).length,
        conflict_claims: domainClaims.filter((claim) => claim.status === "conflict").length
      }];
    })),
    priority_domains: (onboardingPlan.coverage ?? [])
      .filter((item) => ["conflict", "not-covered", "unverified", "detected"].includes(item.status))
      .map((item) => `${item.domain}=${item.status}`)
  };
  const planSketch = summarizeGoalPlan(onboardingPlan);
  const preflight = planSketch.preflight ?? { clarification_questions: [], research_topics: [], research_tasks: [], team_decomposition: [] };
  const clarificationQuestions = preflight.clarification_questions ?? (onboardingPlan.blockers ?? []).slice(0, 3).map((blocker, index) => ({
    id: `clarify-${index + 1}`,
    blocker_id: blocker.id,
    question: blocker.summary,
    priority: index + 1,
    basis: [blocker.id, "plan-clarify"]
  }));
  const stageGates = planSketch.stage_gates ?? {
    implement: { status: "blocked", reasons: ["stage gates unavailable"] },
    verify: { status: "blocked", reasons: ["stage gates unavailable"] },
    deliver: { status: "blocked", reasons: ["stage gates unavailable"] }
  };
  const stageGateBasis = [...new Set([
    ...(stageGates.implement.basis ?? []),
    ...(stageGates.verify.basis ?? []),
    ...(stageGates.deliver.basis ?? [])
  ])].slice(0, 10);
  const executionGraph = planSketch.execution_graph ?? { node_count: 0, max_parallelism: 0, integration_owner_task_id: null, critical_path: [], schedule_valid: false, blocked_reasons: [], next_ready_wave: null, execution_waves: [], nodes: [] };
  const blockers = onboardingPlan.blockers.slice(0, 3);
  const capabilityPriority = new Map(["browser-runtime", "simulator-runtime", "database-runtime", "service-runtime", "dependency-install", "network-research", "container-runtime", "credential-references"].map((id, index) => [id, index]));
  const capabilities = [...onboardingPlan.capability_requests]
    .sort((left, right) => (capabilityPriority.get(left.id) ?? 99) - (capabilityPriority.get(right.id) ?? 99))
    .slice(0, 2);
  const outcomeItems = [item(
    "alignment-original-outcome",
    `Goal as received: ${run.goal.original}`,
    "confirmed",
    "info",
    [source["artifact-goal-input"].id]
  )];
  const executionGraphItems = [
    item(
      "alignment-execution-graph-summary",
      `Execution graph: ${executionGraph.node_count} node(s) · max parallelism ${executionGraph.max_parallelism} · integration owner ${executionGraph.integration_owner_task_id ?? "unknown"} · critical path ${executionGraph.critical_path.join(" → ") || "not yet derivable"} · ${executionGraph.schedule_valid ? (executionGraph.next_ready_wave?.task_ids?.length > 0 ? `next ready wave ${executionGraph.next_ready_wave.index}: ${executionGraph.next_ready_wave.task_ids.join(", ")}` : "next ready wave: none") : `blocked: ${(executionGraph.blocked_reasons ?? []).map((reason) => reason.summary).join("; ") || "schedule invalid"}`}.`,
      "confirmed",
      executionGraph.schedule_valid ? "info" : "warning",
      [source["artifact-onboarding-plan"].id]
    ),
    ...executionGraph.nodes.map((node) => item(
      `alignment-execution-graph-node-${node.task_id}`,
      `${node.task_id}: depends on ${node.depends_on.length > 0 ? node.depends_on.join(", ") : "none"}; resources ${node.resources.length > 0 ? node.resources.join(", ") : "none"}; readiness ${node.readiness}${typeof node.wave_index === "number" ? ` (wave ${node.wave_index})` : ""}.`,
      "confirmed",
      node.readiness === "blocked" ? "warning" : "info",
      [source["artifact-onboarding-plan"].id],
      node.proof_criterion_ids
    ))
  ];
  const projectItems = [
    item(
      "alignment-repository-baseline",
      `${snapshot.repository.name} is bound to committed revision ${run.current_head_sha.slice(0, 12)} with ${snapshot.inventory.file_count} discovered files.`,
      "confirmed",
      "info",
      [source["artifact-repository-snapshot"].id]
    ),
    item(
      "alignment-understanding-summary",
      `Understanding summary: proved ${understandingSummary.proved_claims}/${understandingSummary.total_claims} · unresolved ${understandingSummary.unresolved_claims} · conflicts ${understandingSummary.conflict_claims}. Priority domains: ${understandingSummary.priority_domains.slice(0, 5).join(", ") || "none"}.`,
      "confirmed",
      "warning",
      [source["artifact-onboarding-plan"].id]
    ),
    item(
      "alignment-domain-knownness",
      `Domain knownness: database known ${understandingSummary.domain_knownness.database.known_claims}/${understandingSummary.domain_knownness.database.total_claims} · unknown ${understandingSummary.domain_knownness.database.unknown_claims} · conflict ${understandingSummary.domain_knownness.database.conflict_claims}; frontend known ${understandingSummary.domain_knownness.frontend.known_claims}/${understandingSummary.domain_knownness.frontend.total_claims} · unknown ${understandingSummary.domain_knownness.frontend.unknown_claims} · conflict ${understandingSummary.domain_knownness.frontend.conflict_claims}; backend known ${understandingSummary.domain_knownness.backend.known_claims}/${understandingSummary.domain_knownness.backend.total_claims} · unknown ${understandingSummary.domain_knownness.backend.unknown_claims} · conflict ${understandingSummary.domain_knownness.backend.conflict_claims}. Subdomains: database ${Object.entries(understandingSummary.domain_knownness.database.subdomains).map(([name, stats]) => `${name} ${stats.known_claims}/${stats.total_claims}`).join(", ") || "none"}; frontend ${Object.entries(understandingSummary.domain_knownness.frontend.subdomains).map(([name, stats]) => `${name} ${stats.known_claims}/${stats.total_claims}`).join(", ") || "none"}; backend ${Object.entries(understandingSummary.domain_knownness.backend.subdomains).map(([name, stats]) => `${name} ${stats.known_claims}/${stats.total_claims}`).join(", ") || "none"}.`,
      "confirmed",
      "warning",
      [source["artifact-onboarding-plan"].id]
    ),
    item(
      "alignment-progress-summary",
      `Progress snapshot: ${understandingSummary.proved_claims}/${understandingSummary.total_claims} claims proved · ${understandingSummary.unresolved_claims} unresolved · ${understandingSummary.conflict_claims} conflicts · ${planSketch.acceptance_points.length} acceptance points · ${planSketch.execution_waves.length > 0 ? `${planSketch.execution_waves.length} execution wave(s)` : "no execution waves yet"} · ${planSketch.schedule_valid ? "schedule valid" : "schedule blocked"}.`,
      "confirmed",
      "info",
      [source["artifact-onboarding-plan"].id]
    ),
    item(
      "alignment-plan-crew",
      `Likely crew: ${planSketch.crew.map((crew) => crew.label).join(" · ")}. ${planSketch.crew.map((crew) => `${crew.label}: ${crew.focus}`).join(" · ")}.`,
      "confirmed",
      "info",
      [source["artifact-onboarding-plan"].id]
    ),
    item(
      "alignment-plan-checkpoints",
      `Plan checkpoints: ${planSketch.checkpoints.map((step) => step.label).join(" → ")}.`,
      "confirmed",
      "info",
      [source["artifact-onboarding-plan"].id]
    ),
    item(
      "alignment-plan-preflight",
      `Preflight path: clarify ${clarificationQuestions.length > 0 ? `${clarificationQuestions.length} question(s)` : "none"} → research ${preflight.research_topics.length} topic(s) → split ${preflight.team_decomposition.length} crew group(s). Clarification queue: ${clarificationQuestions.length > 0 ? clarificationQuestions.map((question) => question.question).join(" · ") : "none"}. Research: ${preflight.research_tasks.length > 0 ? preflight.research_tasks.map((task) => `${task.owner ?? "team"}:${task.priority ?? "?"} ${task.query ?? task.topic_id}`).join(" · ") : "none"}. Team decomposition: ${preflight.team_decomposition.length > 0 ? preflight.team_decomposition.map((team) => `${team.label} → ${team.task_ids.join(", ") || "no tasks"}`).join(" | ") : "none"}.`,
      "confirmed",
      "info",
      [source["artifact-onboarding-plan"].id]
    ),
    item(
      "alignment-plan-acceptance",
      `Acceptance checkpoints: ${planSketch.acceptance_points.join(" · ")}.`,
      "confirmed",
      "warning",
      [source["artifact-onboarding-plan"].id]
    ),
    item(
      "alignment-stage-gates",
      `Stage gates: implement ${stageGates.implement.status}${stageGates.implement.reasons.length > 0 ? ` (${stageGates.implement.reasons.join("; ")})` : ""}; verify ${stageGates.verify.status}${stageGates.verify.reasons.length > 0 ? ` (${stageGates.verify.reasons.join("; ")})` : ""}; deliver ${stageGates.deliver.status}${stageGates.deliver.reasons.length > 0 ? ` (${stageGates.deliver.reasons.join("; ")})` : ""}.`,
      "confirmed",
      stageGates.implement.status === "ready" && stageGates.verify.status === "ready" && stageGates.deliver.status === "ready" ? "info" : "warning",
      [source["artifact-onboarding-plan"].id],
      stageGateBasis
    ),
    item(
      "alignment-stage-implement",
      `Implement gate: ${stageGates.implement.status}${stageGates.implement.reasons.length > 0 ? ` (${stageGates.implement.reasons.join("; ")})` : ""}.`,
      "confirmed",
      stageGates.implement.status === "ready" ? "info" : "warning",
      [source["artifact-onboarding-plan"].id],
      stageGates.implement.basis ?? []
    ),
    item(
      "alignment-stage-verify",
      `Verify gate: ${stageGates.verify.status}${stageGates.verify.reasons.length > 0 ? ` (${stageGates.verify.reasons.join("; ")})` : ""}.`,
      "confirmed",
      stageGates.verify.status === "ready" ? "info" : "warning",
      [source["artifact-onboarding-plan"].id],
      stageGates.verify.basis ?? []
    ),
    item(
      "alignment-stage-deliver",
      `Deliver gate: ${stageGates.deliver.status}${stageGates.deliver.reasons.length > 0 ? ` (${stageGates.deliver.reasons.join("; ")})` : ""}.`,
      "confirmed",
      stageGates.deliver.status === "ready" ? "info" : "warning",
      [source["artifact-onboarding-plan"].id],
      stageGates.deliver.basis ?? []
    ),
    item(
      "alignment-detected-stack",
      `Detected surfaces: ${snapshot.detected.platforms.join(", ")}; languages: ${snapshot.detected.languages.join(", ") || "none"}; frameworks: ${snapshot.detected.frameworks.join(", ") || "none"}. Detection is not runtime proof.`,
      "confirmed",
      "warning",
      [source["artifact-repository-snapshot"].id]
    )
  ];
  const gapItems = [
    ...blockers.map((blocker, index) => item(
      `alignment-gap-${index + 1}`,
      blocker.summary,
      "verify",
      "blocking",
      [source["artifact-onboarding-plan"].id]
    )),
    ...capabilities.map((request, index) => item(
      `alignment-capability-${index + 1}`,
      `Capability required: ${request.capability}. ${request.reason} (${request.authority} approval, ${request.risk} risk).`,
      "verify",
      "blocking",
      [source["artifact-onboarding-plan"].id]
    ))
  ];
  if (gapItems.length === 0) gapItems.push(item("alignment-gap-static-proof", "Static discovery cannot prove real user behavior or complete system flows.", "verify", "blocking", [source["artifact-onboarding-plan"].id]));
  const scopeItems = [item(
    "alignment-acceptance-missing",
    "Falsifiable acceptance criteria, non-goals and material product decisions have not been defined or approved.",
    "verify",
    "blocking",
    [source["artifact-goal-input"].id, source["artifact-onboarding-plan"].id]
  )];
  const sections = [
    { id: "alignment-outcome", title: "Outcome", items: outcomeItems },
    { id: "alignment-project", title: "Confirmed project facts", items: projectItems },
    { id: "alignment-execution-graph", title: "Execution graph", items: executionGraphItems },
    { id: "alignment-gaps", title: "What remains unproved", items: gapItems },
    { id: "alignment-scope", title: "Scope checkpoint", items: scopeItems }
  ];
  const surfacedItems = sections.flatMap((section) => section.items);
  const sourceItemCount = 1 + onboardingPlan.claims.length + onboardingPlan.blockers.length + onboardingPlan.capability_requests.length + 10 + executionGraph.nodes.length + 1;
  const packetBody = {
    schema_version: 1,
    run_id: run.id,
    kind: "alignment-brief",
    generated_at: generatedAt,
    head_sha: run.current_head_sha,
    title: `Alignment Brief · ${run.goal.original}`,
    verdict: "action-required",
    summary: "Static project facts are recorded, but runtime understanding and acceptance are not yet proved. Scope approval is unavailable.",
    attention: { required: true, count: 1, reasons: ["verification-blocker"] },
    sections,
    decisions: [],
    actions: [
      { id: "inspect-required-proof", label: "Review missing proof and required capabilities", kind: "inspect", recommended: true },
      { id: "cancel-run", label: "Cancel this Goal Run", kind: "cancel", recommended: false }
    ],
    source_artifacts: artifacts.map((entry) => ({ id: entry.id, kind: entry.kind, sha256: entry.sha256, uri: `artifacts/${entry.id}.json` })),
    traceability: surfacedItems.map((entry) => ({ item_id: entry.id, source_refs: entry.source_refs })),
    compression: {
      source_artifact_count: artifacts.length,
      surfaced_item_count: surfacedItems.length,
      omitted_item_count: Math.max(0, sourceItemCount - surfacedItems.length)
    }
  };
  const packet = { ...packetBody, id: `packet-${hashContract(packetBody).slice(0, 32)}` };
  await assertContract("interaction-packet", packet);
  const packetPolicy = evaluateInteractionPacket(packet);
  if (!packetPolicy.valid) throw new Error(`Interaction packet policy failed: ${packetPolicy.reasons.map((reason) => reason.code).join(", ")}`);

  const sequence = 2;
  const events = [
    transition(run.id, sequence, generatedAt, "received", "discovering"),
    createRunEvent({ runId: run.id, sequence: sequence + 1, at: generatedAt, type: "artifact.written", data: { artifact_id: source["artifact-repository-snapshot"].id, sha256: source["artifact-repository-snapshot"].sha256 } }),
    createRunEvent({ runId: run.id, sequence: sequence + 2, at: generatedAt, type: "artifact.written", data: { artifact_id: source["artifact-onboarding-plan"].id, sha256: source["artifact-onboarding-plan"].sha256 } }),
    transition(run.id, sequence + 3, generatedAt, "discovering", "clarifying"),
    createRunEvent({ runId: run.id, sequence: sequence + 4, at: generatedAt, type: "interaction.published", data: { packet_id: packet.id, packet_sha256: hashContract(packet) } }),
    createRunEvent({ runId: run.id, sequence: sequence + 5, at: generatedAt, type: "attention.requested", data: { packet_id: packet.id, reasons: packet.attention.reasons } })
  ];
  const nextRun = structuredClone(run);
  nextRun.state = "clarifying";
  nextRun.timestamps.updated_at = generatedAt;
  return { run: nextRun, events, packet, artifacts };
}
