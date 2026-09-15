import { evaluateAlignmentPolicy } from "../../core/src/alignment-policy.mjs";
import { evaluateInteractionPacket } from "../../core/src/interaction-policy.mjs";

import { assertContract } from "./contracts.mjs";
import { hashContract } from "./harness.mjs";

function uniqueById(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value?.id || seen.has(value.id)) continue;
    seen.add(value.id);
    result.push(value);
  }
  return result;
}

function packetArtifactFromBundleRef(ref) {
  return {
    id: ref.id,
    kind: ref.kind,
    sha256: ref.sha256,
    ...(ref.storage_key ? { uri: ref.storage_key } : {})
  };
}

function syntheticBundleArtifact(bundle) {
  return {
    id: bundle.id,
    kind: "alignment-bundle",
    sha256: hashContract(bundle),
    uri: `artifacts/${bundle.id}.json`
  };
}

function packetSourceArtifacts(bundle) {
  return uniqueById([
    syntheticBundleArtifact(bundle),
    packetArtifactFromBundleRef(bundle.goal_ref),
    packetArtifactFromBundleRef(bundle.analysis_plan_ref),
    packetArtifactFromBundleRef(bundle.goal_analysis_ref),
    packetArtifactFromBundleRef(bundle.validation_ref),
    ...(bundle.developer_answer_refs ?? []).map(packetArtifactFromBundleRef),
    ...(bundle.research_source_refs ?? []).map(packetArtifactFromBundleRef)
  ]);
}

function sourceIds(refs) {
  return uniqueById((refs ?? []).map((ref) => (typeof ref === "string" ? { id: ref } : ref)).filter(Boolean)).map((ref) => ref.id);
}

function packetItem({ id, text, severity = "info", confidence = "confirmed", sourceRefs, basis = null, metrics = null }) {
  return {
    id,
    text,
    confidence,
    severity,
    source_refs: sourceIds(sourceRefs),
    ...(Array.isArray(basis) && basis.length > 0 ? { basis } : {}),
    ...(metrics ? { metrics } : {})
  };
}

function criterionToPacketItem(criterion, index, bundleId) {
  const sourceRefs = [...(criterion.source_refs ?? []), bundleId];
  return packetItem({
    id: criterion.id ?? `criterion-${index + 1}`,
    text: `Given ${criterion.given}. When ${criterion.when}. Then ${criterion.then}. Proof surface: ${criterion.proof_surface}.`,
    severity: "warning",
    sourceRefs
  });
}

function reviewItemToPacketItem(item, index, bundleId, kindLabel) {
  const sourceRefs = [...(item.source_refs ?? []), bundleId];
  return packetItem({
    id: item.id ?? `${kindLabel}-${index + 1}`,
    text: item.text,
    severity: kindLabel === "boundary" ? "warning" : "info",
    sourceRefs
  });
}

function summarizeAreas(bundle) {
  const counts = {
    applicable: 0,
    "not-applicable": 0,
    conflict: 0,
    gap: 0
  };
  const statuses = [];
  for (const decision of bundle.area_decisions ?? []) {
    counts[decision.status] += 1;
    statuses.push(`${decision.area}=${decision.status}`);
  }
  return {
    counts,
    statuses
  };
}

function summarizeClaims(bundle) {
  const counts = {
    detected: 0,
    documented: 0,
    "code-confirmed": 0,
    "test-confirmed": 0,
    "runtime-observed": 0,
    conflict: 0,
    unverified: 0,
    "not-covered": 0
  };
  for (const claim of bundle.classified_claims ?? []) {
    if (Object.hasOwn(counts, claim.status)) counts[claim.status] += 1;
  }
  return counts;
}

function countHiddenItems(bundle, visibleDecisionCount, surfacedBoundaryCount, surfacedNonGoalCount, surfacedCriterionCount) {
  return (
    (bundle.classified_claims?.length ?? 0) +
    (bundle.area_decisions?.length ?? 0) +
    (bundle.assumptions?.length ?? 0) +
    (bundle.conflicts?.length ?? 0) +
    Math.max(0, (bundle.material_decisions?.length ?? 0) - visibleDecisionCount) +
    Math.max(0, (bundle.boundaries?.length ?? 0) - surfacedBoundaryCount) +
    Math.max(0, (bundle.non_goals?.length ?? 0) - surfacedNonGoalCount) +
    Math.max(0, (bundle.acceptance_criteria?.length ?? 0) - surfacedCriterionCount)
  );
}

export async function buildValidatedAlignmentBundle({ bundle, goalAnalysis, validation, trustContext = null }) {
  const validated = evaluateAlignmentPolicy({ bundle, goalAnalysis, validation, trustContext });
  const result = validated.bundle;
  await assertContract("alignment-bundle", result);
  return validated;
}

export async function buildCompactAlignmentPacket({ bundle, generatedAt = new Date().toISOString() }) {
  const source_artifacts = packetSourceArtifacts(bundle);
  const bundleRef = source_artifacts[0];
  const visibleDecisions = (bundle.material_decisions ?? []).slice(0, 3);
  const questionCount = bundle.material_decisions?.length ?? 0;
  const areaSummary = summarizeAreas(bundle);
  const claimSummary = summarizeClaims(bundle);
  const surfacedBoundaries = (bundle.boundaries ?? []).slice(0, 3);
  const surfacedNonGoals = (bundle.non_goals ?? []).slice(0, 3);
  const surfacedCriteria = (bundle.acceptance_criteria ?? []).slice(0, 3);
  const isReady = bundle.verdict === "ready";
  const isDecisionQueue = !isReady && visibleDecisions.length > 0;
  const sections = [
    {
      id: "alignment-outcome",
      title: "Refined outcome",
      items: [
        packetItem({
          id: "alignment-outcome-1",
          text: bundle.refined_outcome?.text ?? "No refined outcome is available.",
          severity: isReady ? "info" : "warning",
          sourceRefs: [bundle.goal_ref.id, bundle.goal_analysis_ref.id, bundle.validation_ref.id, bundleRef.id]
        })
      ]
    },
    {
      id: "alignment-understanding",
      title: "Confirmed project/system understanding",
      items: [
        packetItem({
          id: "alignment-understanding-1",
          text: `Area coverage: ${areaSummary.counts.applicable} applicable · ${areaSummary.counts["not-applicable"]} not-applicable · ${areaSummary.counts.gap} gaps · ${areaSummary.counts.conflict} conflicts. Areas: ${areaSummary.statuses.join(" · ") || "none"}.`,
          severity: areaSummary.counts.gap > 0 || areaSummary.counts.conflict > 0 ? "warning" : "info",
          sourceRefs: [bundle.goal_analysis_ref.id, bundle.validation_ref.id, bundleRef.id]
        }),
        packetItem({
          id: "alignment-understanding-2",
          text: `Claims: ${claimSummary["code-confirmed"] + claimSummary.documented + claimSummary.detected} surfaced as supported or detected · ${claimSummary.conflict} conflicts · ${claimSummary.unverified + claimSummary["not-covered"]} unresolved.`,
          severity: claimSummary.conflict > 0 || claimSummary.unverified > 0 || claimSummary["not-covered"] > 0 ? "warning" : "info",
          sourceRefs: [bundle.goal_analysis_ref.id, bundle.validation_ref.id, bundleRef.id]
        })
      ]
    },
    {
      id: "alignment-boundaries",
      title: "Boundaries/non-goals",
      items: [
        ...surfacedBoundaries.map((item, index) => reviewItemToPacketItem(item, index, bundleRef.id, "boundary")),
        ...surfacedNonGoals.map((item, index) => reviewItemToPacketItem(item, index, bundleRef.id, "non-goal")),
        ...(surfacedBoundaries.length === 0 && surfacedNonGoals.length === 0
          ? [packetItem({
              id: "alignment-boundaries-none",
              text: "No explicit boundaries or non-goals were recorded.",
              severity: "info",
              sourceRefs: [bundle.goal_analysis_ref.id, bundleRef.id]
            })]
          : [])
      ]
    },
    {
      id: "alignment-criteria",
      title: "Acceptance criteria/proof gaps",
      items: [
        ...surfacedCriteria.map((criterion, index) => criterionToPacketItem(criterion, index, bundleRef.id)),
        packetItem({
          id: "alignment-proof-gaps",
          text: bundle.verdict === "ready"
            ? "No unresolved proof gaps remain."
            : `${bundle.blocking_ids.length} blocking id(s) remain and the remaining evidence is not yet approvable.`,
          severity: bundle.verdict === "ready" ? "info" : "warning",
          sourceRefs: [bundle.validation_ref.id, bundleRef.id]
        })
      ]
    },
    ...(isDecisionQueue
      ? [
          {
            id: "alignment-questions",
            title: "Questions to answer",
            items: [
              packetItem({
                id: "alignment-questions-1",
                text: `Showing ${visibleDecisions.length} of ${questionCount} material question(s). Review the decision list below.`,
                severity: "blocking",
                confidence: "verify",
                sourceRefs: [bundle.goal_analysis_ref.id, bundle.validation_ref.id, bundleRef.id]
              })
            ]
          }
        ]
      : [])
  ];

  const packet = {
    schema_version: 1,
    id: `interaction-packet-${hashContract({
      bundle_id: bundle.id,
      verdict: bundle.verdict,
      visible_decision_ids: visibleDecisions.map((decision) => decision.id),
      section_ids: sections.map((section) => section.id)
    }).slice(0, 32)}`,
    run_id: bundle.run_id,
    kind: isReady ? "alignment-brief" : (isDecisionQueue ? "decision-queue" : "progress-pulse"),
    generated_at: generatedAt,
    head_sha: bundle.commit_sha,
    title: isReady
      ? `Alignment Brief · ${bundle.refined_outcome?.text ?? bundle.id}`
      : `Decision Queue · ${bundle.refined_outcome?.text ?? bundle.id}`,
    verdict: isReady ? "ready" : (isDecisionQueue ? "action-required" : "blocked"),
    summary: isReady
      ? "The bundle is ready for explicit scope approval."
      : (isDecisionQueue
        ? `The bundle still has ${visibleDecisions.length} developer decision(s) to answer before scope can move forward.`
        : "The bundle is blocked by remaining proof gaps but has no unresolved developer decisions."),
    attention: isReady
      ? { required: true, count: 0, reasons: ["gate-approval"] }
      : (isDecisionQueue
        ? { required: true, count: visibleDecisions.length, reasons: ["goal-ambiguity", "verification-blocker"] }
        : { required: false, count: 0, reasons: [] }),
    sections,
    decisions: isReady ? [] : visibleDecisions.map((decision) => ({
      id: decision.id,
      question: decision.question,
      why_now: decision.why_now,
      impact: decision.impact,
      reversibility: decision.reversibility,
      recommended_option_id: decision.recommended_option_id,
      options: (decision.options ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        outcome: option.outcome,
        tradeoffs: option.tradeoffs
      }))
    })),
    actions: isReady
      ? [
          { id: "approve-scope", label: "Approve scope", kind: "approve", recommended: true },
          { id: "inspect-brief", label: "Inspect the brief", kind: "inspect", recommended: false }
        ]
      : (isDecisionQueue
        ? [
            { id: "answer-question", label: "Answer the blocked question", kind: "answer", recommended: true },
            { id: "inspect-brief", label: "Inspect the bundle", kind: "inspect", recommended: false }
          ]
        : [
            { id: "inspect-progress", label: "Inspect the current progress", kind: "inspect", recommended: true }
          ]),
    source_artifacts,
    traceability: [
      ...sections.flatMap((section) => section.items).map((item) => ({
        item_id: item.id,
        source_refs: item.source_refs
      })),
      ...visibleDecisions.map((decision) => ({
        item_id: decision.id,
        source_refs: sourceIds(decision.source_refs ?? []).length > 0 ? sourceIds(decision.source_refs ?? []) : [bundleRef.id]
      }))
    ],
    compression: {
      source_artifact_count: source_artifacts.length,
      surfaced_item_count: sections.flatMap((section) => section.items).length + visibleDecisions.length,
      omitted_item_count: countHiddenItems(
        bundle,
        visibleDecisions.length,
        surfacedBoundaries.length,
        surfacedNonGoals.length,
        surfacedCriteria.length
      )
    }
  };

  await assertContract("interaction-packet", packet);
  const interactionCheck = evaluateInteractionPacket(packet);
  if (!interactionCheck.valid) {
    const details = interactionCheck.reasons.map((reason) => `${reason.code}: ${reason.summary}`).join("; ");
    throw new Error(`Projected interaction packet is invalid: ${details}`);
  }

  return packet;
}

export async function projectValidatedAlignment({ bundle, goalAnalysis, validation, trustContext = null, generatedAt = new Date().toISOString() }) {
  const validated = await buildValidatedAlignmentBundle({ bundle, goalAnalysis, validation, trustContext });
  const packet = await buildCompactAlignmentPacket({ bundle: validated.bundle, generatedAt });
  return { bundle: validated.bundle, packet, reasons: validated.reasons };
}
