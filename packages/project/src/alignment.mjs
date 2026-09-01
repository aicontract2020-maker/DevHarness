import { createRunEvent } from "../../core/src/goal-run.mjs";
import { evaluateInteractionPacket } from "../../core/src/interaction-policy.mjs";
import { assertContract } from "./contracts.mjs";
import { hashContract } from "./harness.mjs";

const PROVED_STATUSES = new Set(["code-confirmed", "test-confirmed", "runtime-observed"]);

function artifact(id, kind, value) {
  return { id, kind, value, sha256: hashContract(value) };
}

function item(id, text, confidence, severity, sourceRefs) {
  return { id, text, confidence, severity, source_refs: sourceRefs };
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

  const artifacts = [
    artifact("artifact-goal-input", "goal-input", { run_id: run.id, original_goal: run.goal.original, scope_version: run.goal.scope_version }),
    artifact("artifact-repository-snapshot", "repository-snapshot", snapshot),
    artifact("artifact-onboarding-plan", "onboarding-plan", onboardingPlan)
  ];
  const source = Object.fromEntries(artifacts.map((entry) => [entry.id, entry]));
  const confirmedClaims = onboardingPlan.claims.filter((claim) => PROVED_STATUSES.has(claim.status));
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
  const projectItems = [
    item(
      "alignment-repository-baseline",
      `${snapshot.repository.name} is bound to committed revision ${run.current_head_sha.slice(0, 12)} with ${snapshot.inventory.file_count} discovered files.`,
      "confirmed",
      "info",
      [source["artifact-repository-snapshot"].id]
    ),
    item(
      "alignment-detected-stack",
      `Detected surfaces: ${snapshot.detected.platforms.join(", ")}; languages: ${snapshot.detected.languages.join(", ") || "none"}; frameworks: ${snapshot.detected.frameworks.join(", ") || "none"}. Detection is not runtime proof.`,
      "confirmed",
      "warning",
      [source["artifact-repository-snapshot"].id]
    ),
    ...confirmedClaims.slice(0, 2).map((claim, index) => item(
      `alignment-confirmed-${index + 1}`,
      claim.summary,
      "confirmed",
      "info",
      [source["artifact-onboarding-plan"].id]
    ))
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
    { id: "alignment-gaps", title: "What remains unproved", items: gapItems },
    { id: "alignment-scope", title: "Scope checkpoint", items: scopeItems }
  ];
  const surfacedItems = sections.flatMap((section) => section.items);
  const sourceItemCount = 1 + onboardingPlan.claims.length + onboardingPlan.blockers.length + onboardingPlan.capability_requests.length + 3;
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
