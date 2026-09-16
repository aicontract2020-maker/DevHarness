import { evaluateDeliveryReadiness } from "./delivery-readiness.mjs";
import { isTrustedEvaluationContext } from "./trusted-context.mjs";

const LEVEL_VALUE = Object.freeze({ E0: 0, E1: 1, E2: 2, E3: 3, E4: 4 });

const DIMENSIONS = Object.freeze([
  { id: "acceptance-definition", label: "Acceptance definition", weight: 20 },
  { id: "system-understanding", label: "System understanding", weight: 20 },
  { id: "delivery-traceability", label: "Delivery traceability", weight: 20 },
  { id: "verification-sufficiency", label: "Verification sufficiency", weight: 30 },
  { id: "review-closure", label: "Independent review and closure", weight: 10 }
]);

function sorted(values, selector = (value) => value.id ?? String(value)) {
  return [...values].sort((left, right) => selector(left).localeCompare(selector(right)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function inferredRequiredLevel(criterion) {
  if (criterion.proof?.required_level) return criterion.proof.required_level;
  if (criterion.category === "delivery" || criterion.category === "performance") return "E4";
  if (criterion.category === "behavior") return "E3";
  return "E2";
}

function inferredEvidenceLevel(record) {
  if (record.level) return record.level;
  if (["browser-snapshot", "screenshot", "console", "network", "api-response", "database-state", "filesystem-state"].includes(record.type)) return "E3";
  if (["test-result", "command-output", "performance-measurement", "review-report"].includes(record.type)) return "E2";
  return "E1";
}

function highestLevel(records) {
  return records.reduce((highest, record) => {
    const candidate = inferredEvidenceLevel(record);
    return LEVEL_VALUE[candidate] > LEVEL_VALUE[highest] ? candidate : highest;
  }, "E0");
}

function weightedDimension(definition, proved, applicable) {
  const weightedScore = applicable === 0 ? 0 : Math.round(definition.weight * proved / applicable);
  return {
    ...definition,
    proved,
    applicable,
    weighted_score: weightedScore,
    status: applicable === 0 ? "not-applicable" : proved === applicable ? "pass" : "gap"
  };
}

function reasonType(code) {
  if (code.includes("trusted")) return "trust";
  if (code.includes("evidence") || code.includes("verification")) return "evidence";
  if (code.includes("review") || code.includes("finding")) return "review";
  if (code.includes("scope")) return "scope";
  if (code.includes("criterion")) return "acceptance";
  return "trust";
}

function reasonAction(code) {
  if (code === "trusted_delivery_context_missing") return "Load Supervisor-verified evidence for this repository revision.";
  if (code.includes("review")) return "Complete an independent current-revision review and attest its result.";
  if (code.includes("evidence") || code.includes("verification")) return "Produce the required current-revision evidence through the configured proof driver.";
  if (code.includes("scope")) return "Approve the exact current scope before continuing.";
  return "Resolve this hard-gate failure and recompute the scorecard.";
}

function countStatuses(criteria) {
  const counts = { total: criteria.length, pass: 0, fail: 0, blocked: 0, pending: 0, not_applicable: 0 };
  for (const criterion of criteria) counts[criterion.status] += 1;
  return counts;
}

function evidenceCounts(criteria) {
  const counts = { E0: 0, E1: 0, E2: 0, E3: 0, E4: 0 };
  for (const criterion of criteria) counts[criterion.achieved_evidence_level] += 1;
  return counts;
}

export function createReviewScorecard({
  run,
  scopeHash,
  harnessVersion,
  title,
  requirements = [],
  criticalFlows = [],
  criteria = [],
  evidence = [],
  traces = [],
  reviewVerdicts = [],
  reviewChecks = [],
  findings = [],
  implementationActorIds = [],
  unknowns = [],
  conflicts = [],
  orphanTaskIds = [],
  orphanChangeRefs = [],
  unnecessaryQuestionIds = [],
  lateScopeChangeIds = [],
  sourceArtifactCount,
  omittedItemCount = 0,
  generatedAt = new Date().toISOString(),
  dataSource = "runtime",
  trustContext,
  profile = "full"
}) {
  if (!run?.id || !run?.current_head_sha || !run?.repository?.identity) {
    throw new Error("Review scorecard requires a run id, repository identity and current head.");
  }
  if (!/^[0-9a-f]{64}$/.test(scopeHash ?? "")) throw new Error("Review scorecard requires a canonical scope SHA-256 hash.");
  if (!harnessVersion) throw new Error("Review scorecard requires a project-harness version.");

  const trusted = isTrustedEvaluationContext(trustContext);
  const trustedEvidence = trusted ? trustContext.evidence : [];
  const implementers = new Set(implementationActorIds);
  const traceIndex = new Map(traces.map((trace) => [trace.criterion_id, trace]));

  const delivery = evaluateDeliveryReadiness({
    run,
    criteria,
    evidence,
    reviewVerdicts,
    findings,
    implementationActorIds,
    trustContext,
    profile
  });

  const criterionRows = sorted(criteria).map((criterion) => {
    const requiredLevel = inferredRequiredLevel(criterion);
    const currentEvidence = trustedEvidence.filter((record) =>
      record.run_id === run.id &&
      record.subject?.commit_sha === run.current_head_sha &&
      record.criterion_ids?.includes(criterion.id) &&
      record.observation?.result === "pass" &&
      criterion.verdict.evidence_refs.includes(record.id)
    );
    const achievedLevel = highestLevel(currentEvidence);
    const actualTypes = new Set(currentEvidence.map((record) => record.type));
    const requiredTypesPresent = criterion.proof.evidence_types.every((type) => actualTypes.has(type));
    const independent = !criterion.proof.independent || currentEvidence.some((record) => !implementers.has(record.producer?.id));
    const sufficient =
      criterion.verdict.status === "pass" &&
      LEVEL_VALUE[achievedLevel] >= LEVEL_VALUE[requiredLevel] &&
      requiredTypesPresent &&
      independent;
    const trace = traceIndex.get(criterion.id) ?? {};
    const status = criterion.verdict.status === "not_applicable"
      ? "not_applicable"
      : sufficient
        ? "pass"
        : criterion.verdict.status === "fail"
          ? "fail"
          : criterion.verdict.status === "pending"
            ? "pending"
            : "blocked";

    return {
      id: criterion.id,
      title: criterion.claim,
      priority: criterion.blocking ? "must" : "should",
      required_evidence_level: requiredLevel,
      achieved_evidence_level: achievedLevel,
      status,
      proof_summary: sufficient
        ? `${currentEvidence.length} trusted current-revision evidence record${currentEvidence.length === 1 ? "" : "s"}.`
        : criterion.verdict.reason ?? `Required ${requiredLevel} proof is incomplete.`,
      requirement_refs: unique(trace.requirement_refs ?? []),
      task_refs: unique(trace.task_refs ?? []),
      change_refs: unique(trace.change_refs ?? []),
      evidence_refs: unique(currentEvidence.map((record) => record.id)),
      review_refs: unique(trace.review_refs ?? []),
      replay_recipe: criterion.proof.recipe
    };
  });

  const criterionIndex = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const acceptanceDefined = requirements.filter((requirement) =>
    requirement.criterion_ids?.length > 0 && requirement.criterion_ids.every((id) => {
      const criterion = criterionIndex.get(id);
      return Boolean(criterion?.proof?.recipe && criterion.proof.evidence_types?.length > 0 && inferredRequiredLevel(criterion));
    })
  ).length;
  const understoodFlows = criticalFlows.filter((flow) => flow.status === "confirmed" && flow.source_refs?.length > 0).length;
  const mustRows = criterionRows.filter((criterion) => criterion.priority === "must");
  const tracedRows = mustRows.filter((criterion) =>
    criterion.requirement_refs.length > 0 && criterion.task_refs.length > 0 &&
    criterion.change_refs.length > 0 && (criterion.evidence_refs.length > 0 || criterion.status !== "pass")
  ).length;
  const verifiedRows = mustRows.filter((criterion) => criterion.status === "pass").length;
  const blockingFindings = findings.filter((finding) => finding.head_sha === run.current_head_sha && finding.severity === "blocking");
  const reviewApplicable = reviewChecks.length + blockingFindings.length;
  const reviewProved = reviewChecks.filter((check) => check.status === "pass").length +
    blockingFindings.filter((finding) => finding.status === "resolved" || finding.status === "dismissed" || (finding.status === "accepted_risk" && finding.resolution?.resolved_by?.kind === "human")).length;

  const dimensions = [
    weightedDimension(DIMENSIONS[0], acceptanceDefined, requirements.length),
    weightedDimension(DIMENSIONS[1], understoodFlows, criticalFlows.length),
    weightedDimension(DIMENSIONS[2], tracedRows, mustRows.length),
    weightedDimension(DIMENSIONS[3], verifiedRows, mustRows.length),
    weightedDimension(DIMENSIONS[4], reviewProved, reviewApplicable)
  ];

  const deliveryReasons = sorted(delivery.reasons, (reason) => `${reason.code}:${(reason.refs ?? []).join(":")}`);
  const hardGates = deliveryReasons.map((reason, index) => ({
    id: `gate-${reason.code}-${index + 1}`,
    label: reason.code.replaceAll("_", " "),
    status: "fail",
    reason: reason.message,
    source_refs: unique(reason.refs ?? [])
  }));
  sorted(unknowns).forEach((unknown, index) => hardGates.push({
    id: `gate-unknown-${index + 1}`,
    label: "Critical unknown resolved",
    status: "fail",
    reason: unknown.summary ?? unknown.title ?? String(unknown.id),
    source_refs: unique(unknown.source_refs ?? [])
  }));
  sorted(conflicts).forEach((conflict, index) => hardGates.push({
    id: `gate-conflict-${index + 1}`,
    label: "Requirement conflict resolved",
    status: "fail",
    reason: conflict.summary ?? conflict.title ?? String(conflict.id),
    source_refs: unique(conflict.source_refs ?? [])
  }));
  if (hardGates.length === 0) hardGates.push({ id: "gate-delivery-policy", label: "Delivery policy", status: "pass", reason: "All delivery hard gates passed.", source_refs: [] });

  const exceptions = deliveryReasons.map((reason, index) => ({
    id: `exception-${reason.code}-${index + 1}`,
    severity: "blocking",
    type: reasonType(reason.code),
    title: reason.code.replaceAll("_", " "),
    detail: reason.message,
    affected_outcome: "Delivery approval",
    source_refs: unique(reason.refs ?? []),
    required_action: reasonAction(reason.code)
  }));
  sorted(unknowns).forEach((unknown, index) => exceptions.push({
    id: `exception-unknown-${index + 1}`, severity: "blocking", type: "unknown",
    title: unknown.title ?? "Critical unknown", detail: unknown.summary ?? String(unknown.id),
    affected_outcome: unknown.affected_outcome ?? "Approved scope", source_refs: unique(unknown.source_refs ?? []),
    required_action: unknown.required_action ?? "Resolve and verify the unknown before approval."
  }));
  sorted(conflicts).forEach((conflict, index) => exceptions.push({
    id: `exception-conflict-${index + 1}`, severity: "blocking", type: "conflict",
    title: conflict.title ?? "Requirement conflict", detail: conflict.summary ?? String(conflict.id),
    affected_outcome: conflict.affected_outcome ?? "Approved scope", source_refs: unique(conflict.source_refs ?? []),
    required_action: conflict.required_action ?? "Resolve the conflict and re-approve the affected scope."
  }));

  const unmappedRequirements = requirements.filter((requirement) =>
    !requirement.criterion_ids?.length || requirement.criterion_ids.some((id) => !criterionIndex.has(id))
  ).length;
  const staleOrInvalidEvidence = evidence.filter((record) => record.run_id !== run.id || record.subject?.commit_sha !== run.current_head_sha || record.observation?.result !== "pass").length;
  const openFindings = findings.filter((finding) => finding.status === "open");
  const openSecurityFindings = openFindings.filter((finding) => finding.category === "security" || /security|auth|permission|secret|privacy/i.test(finding.claim ?? "")).length;
  const openDataFindings = openFindings.filter((finding) => finding.category === "data-integrity" || /database|data integrity|transaction|migration/i.test(finding.claim ?? "")).length;
  const acceptanceCounts = countStatuses(criterionRows);
  const evidenceLevelCounts = evidenceCounts(criterionRows);
  const score = dimensions.reduce((total, dimension) => total + dimension.weighted_score, 0);
  const verdict = hardGates.some((gate) => gate.status === "fail")
    ? (!trusted || !run.current_head_sha ? "blocked" : "not-ready")
    : "ready";
  const refs = unique([
    ...requirements.flatMap((item) => item.source_refs ?? []),
    ...criticalFlows.flatMap((item) => item.source_refs ?? []),
    ...criterionRows.flatMap((item) => [...item.requirement_refs, ...item.task_refs, ...item.change_refs, ...item.evidence_refs, ...item.review_refs])
  ]);

  return {
    schema_version: 1,
    id: `scorecard-${run.id}`,
    run_id: run.id,
    generated_at: generatedAt,
    repository_identity: run.repository.identity,
    head_sha: run.current_head_sha,
    scope_sha256: scopeHash,
    harness_version: harnessVersion,
    title,
    summary: verdict === "ready"
      ? "All delivery hard gates passed. The run is ready for developer approval."
      : `${exceptions.length} blocking exception${exceptions.length === 1 ? "" : "s"} require attention before delivery approval.`,
    data_source: dataSource,
    verdict,
    proof_coverage: { score, dimensions },
    hard_gates: hardGates,
    acceptance_counts: acceptanceCounts,
    evidence_level_counts: evidenceLevelCounts,
    exception_counts: {
      blocking: exceptions.filter((item) => item.severity === "blocking").length,
      unknowns: unknowns.length,
      conflicts: conflicts.length,
      unmapped_requirements: unmappedRequirements,
      orphan_tasks: orphanTaskIds.length,
      orphan_changes: orphanChangeRefs.length,
      below_level_evidence: criterionRows.filter((criterion) => LEVEL_VALUE[criterion.achieved_evidence_level] < LEVEL_VALUE[criterion.required_evidence_level]).length,
      stale_or_invalid_evidence: staleOrInvalidEvidence,
      open_security_findings: openSecurityFindings,
      open_data_integrity_findings: openDataFindings,
      unnecessary_questions: unnecessaryQuestionIds.length,
      late_scope_changes: lateScopeChangeIds.length
    },
    exceptions,
    criteria: criterionRows,
    integrity: {
      trusted_context: trusted,
      source_artifact_count: sourceArtifactCount ?? refs.length,
      surfaced_item_count: exceptions.length + criterionRows.length,
      omitted_item_count: omittedItemCount
    }
  };
}
