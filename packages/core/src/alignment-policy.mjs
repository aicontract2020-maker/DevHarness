import { createHash } from "node:crypto";

import { isTrustedEvaluationContext } from "./trusted-context.mjs";

const AREA_ORDER = [
  "repository-bootstrap",
  "frontend",
  "backend",
  "data",
  "security",
  "integration",
  "testing",
  "deployment",
  "automation"
];

const AREA_TO_DOMAIN = new Map([
  ["repository-bootstrap", "repository"],
  ["frontend", "frontend"],
  ["backend", "backend"],
  ["data", "database"],
  ["security", "security"],
  ["integration", "runtime"],
  ["testing", "testing"],
  ["deployment", "deployment"],
  ["automation", "automation"]
]);

const MATERIAL_DIMENSION_PRIORITY = [
  "irreversible-destructive",
  "security-privacy-credential",
  "data-schema-migration",
  "externally-observable-behavior",
  "architecture-dependency",
  "role-permission",
  "persistence-rule",
  "external-interface",
  "deployment-behavior",
  "acceptance-criterion",
  "explicit-non-goal"
];

const SUPPORTED_CLAIM_CLASSES = ["detected", "documented", "code-confirmed"];
const CLAIM_CLASS_RANK = new Map([
  ["detected", 0],
  ["documented", 1],
  ["code-confirmed", 2]
]);
const POLICY_VERSION_SHA256 = createHash("sha256").update("alignment-policy-v1").digest("hex");

function addReason(reasons, code, summary, subject = null) {
  reasons.push({ code, summary, ...(subject ? { subject } : {}) });
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function sourceRefsOf(item) {
  return Array.isArray(item?.source_refs) && item.source_refs.length > 0 ? item.source_refs : [];
}

function minRankedClaimClass(proposedClass, maxSupportedClass) {
  if (typeof proposedClass !== "string") return "unverified";
  if (["conflict", "unverified", "not-covered"].includes(proposedClass)) return proposedClass;
  const proposedRank = CLAIM_CLASS_RANK.get(proposedClass);
  const supportedRank = CLAIM_CLASS_RANK.get(maxSupportedClass);
  if (typeof proposedRank !== "number" || typeof supportedRank !== "number") return maxSupportedClass ?? "unverified";
  return SUPPORTED_CLAIM_CLASSES[Math.min(proposedRank, supportedRank)];
}

function materialDimensionRank(dimensions = []) {
  const ranks = dimensions.map((dimension) => MATERIAL_DIMENSION_PRIORITY.indexOf(dimension)).filter((rank) => rank >= 0);
  return ranks.length > 0 ? Math.min(...ranks) : MATERIAL_DIMENSION_PRIORITY.length;
}

function materialDecisionForQuestion(question) {
  const dimensions = unique(question.material_dimensions ?? []);
  const priorityDimension = [...dimensions].sort((left, right) => materialDimensionRank([left]) - materialDimensionRank([right]))[0] ?? "acceptance-criterion";
  const recommended = question.options?.find((option) => option.recommended) ?? question.options?.[0];
  return {
    id: question.id,
    question: question.question,
    why_now: `The highest-priority material dimension is ${priorityDimension}; cited sources: ${(question.source_refs ?? []).map((ref) => ref.artifact_id).join(", ") || "none"}.`,
    impact: ["irreversible-destructive", "security-privacy-credential", "data-schema-migration", "role-permission"].includes(priorityDimension) ? "high" : "medium",
    reversibility: priorityDimension === "irreversible-destructive"
      ? "irreversible"
      : ["data-schema-migration", "architecture-dependency", "deployment-behavior"].includes(priorityDimension)
        ? "costly"
        : "reversible",
    recommended_option_id: recommended?.id ?? question.options?.[0]?.id ?? `${question.id}-option`,
    options: (question.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      outcome: option.outcome,
      tradeoffs: option.tradeoffs,
      recommended: option.recommended === true
    })),
    material_dimensions: dimensions.length > 0 ? [...dimensions].sort((left, right) => MATERIAL_DIMENSION_PRIORITY.indexOf(left) - MATERIAL_DIMENSION_PRIORITY.indexOf(right)) : ["acceptance-criterion"],
    source_refs: sourceRefsOf(question)
  };
}

function areaApplicability(area, trustContext, areaAssessment, areaCheck) {
  const domain = AREA_TO_DOMAIN.get(area);
  const inventory = trustContext?.inventory ?? null;
  const expectedDomains = new Set(inventory?.expectedDomains ?? []);
  const required = domain ? expectedDomains.has(domain) : false;
  const proposed = areaAssessment?.proposed_status ?? "gap";
  const validationApplicable = areaCheck?.applicable === true;
  const validationCovered = areaCheck?.covered === true;
  const validationConflict = areaCheck?.conflict === true;

  if (validationConflict || proposed === "conflict") {
    return { required, status: "conflict" };
  }

  if (!required) {
    if (proposed === "not-applicable" && validationApplicable === false) {
      return { required, status: "not-applicable" };
    }
    return { required, status: "gap" };
  }

  if (proposed === "not-applicable" || validationApplicable === false || validationCovered === false) {
    return { required, status: "gap" };
  }

  return { required, status: "applicable" };
}

export function evaluateAlignmentPolicy({ bundle, goalAnalysis, validation, trustContext = null }) {
  const reasons = [];
  const trusted = isTrustedEvaluationContext(trustContext);

  if (!trusted) {
    addReason(reasons, "trusted_alignment_context_missing", "Alignment readiness requires a trusted inventory and validation boundary.");
  }
  if (validation?.producer_analysis_id !== goalAnalysis?.id) {
    addReason(reasons, "producer_analysis_mismatch", "The validation record does not reference the current producer analysis.");
  }
  if (goalAnalysis?.invocation_id === validation?.invocation_id) {
    addReason(reasons, "validator_invocation_reused", "The validator must be a fresh invocation distinct from the producer analysis session.");
  }
  if (validation?.verdict && !["valid", "blocked", "conflict"].includes(validation.verdict)) {
    addReason(reasons, "validation_verdict_invalid", "The validation verdict is not recognized.");
  }

  const claims = Array.isArray(goalAnalysis?.claims) ? goalAnalysis.claims : [];
  const citationChecks = Array.isArray(validation?.citation_checks) ? validation.citation_checks : [];
  const citationByProposalId = new Map(citationChecks.map((check) => [check.proposal_id, check]));
  const claimLimit = 100;
  if (claims.length > claimLimit) {
    addReason(reasons, "claim_ceiling_exceeded", `The analysis proposes ${claims.length} claims; only ${claimLimit} may be surfaced.`);
  }

  const classifiedClaims = claims.slice(0, claimLimit).map((claim) => {
    const citation = citationByProposalId.get(claim.id);
    let status = "unverified";
    if (!citation) {
      addReason(reasons, "claim_citation_missing", `Claim ${claim.id} has no citation check.`, claim.id);
    } else if (citation.exists !== true || citation.supports !== true) {
      status = "conflict";
      addReason(reasons, "citation_conflict", `Claim ${claim.id} is not supported by its cited source.`, claim.id);
    } else {
      status = minRankedClaimClass(claim.proposed_class, citation.max_supported_class);
      if (status !== claim.proposed_class && SUPPORTED_CLAIM_CLASSES.includes(claim.proposed_class) && CLAIM_CLASS_RANK.get(claim.proposed_class) > CLAIM_CLASS_RANK.get(citation.max_supported_class)) {
        addReason(reasons, "claim_class_clamped", `Claim ${claim.id} was clamped to its supported class.`, claim.id);
      }
    }

    return {
      id: claim.id,
      area: claim.area,
      text: claim.text,
      status,
      source_refs: sourceRefsOf(claim),
      validator_check_ids: [citation?.id ?? `citation-missing-${claim.id}`]
    };
  });

  const areaAssessments = new Map((goalAnalysis?.affected_areas ?? []).map((entry) => [entry.area, entry]));
  const areaChecks = new Map((validation?.area_checks ?? []).map((entry) => [entry.area, entry]));
  const claimIdsByArea = new Map(AREA_ORDER.map((area) => [area, classifiedClaims.filter((claim) => claim.area === area).map((claim) => claim.id)]));
  const areaDecisions = AREA_ORDER.map((area) => {
    const areaAssessment = areaAssessments.get(area);
    const areaCheck = areaChecks.get(area);
    const result = areaApplicability(area, trustContext, areaAssessment, areaCheck);
    if (result.status === "gap" && result.required) {
      addReason(reasons, "area_applicability_mismatch", `Area ${area} is required but cannot be marked not-applicable.`, area);
    }
    if (result.status === "conflict") {
      addReason(reasons, "area_conflict", `Area ${area} has a conflicting applicability assessment.`, area);
    }

    return {
      id: areaAssessment?.id ?? `area-${area}`,
      area,
      status: result.status,
      summary: areaAssessment?.summary ?? areaCheck?.summary ?? `${area} is ${result.status}.`,
      claim_ids: claimIdsByArea.get(area) ?? [],
      source_refs: sourceRefsOf(areaAssessment).length > 0 ? sourceRefsOf(areaAssessment) : sourceRefsOf(areaCheck)
    };
  });

  const questions = Array.isArray(goalAnalysis?.questions) ? goalAnalysis.questions : [];
  const questionChecks = new Map((validation?.question_checks ?? []).map((entry) => [entry.question_id, entry]));
  const materialDecisions = questions.map((question) => {
    const check = questionChecks.get(question.id);
    if (!check) {
      addReason(reasons, "question_check_missing", `Question ${question.id} has no validation check.`, question.id);
    } else if (check.complete !== true) {
      addReason(reasons, "question_incomplete", `Question ${question.id} remains unresolved.`, question.id);
    }
    return materialDecisionForQuestion(question);
  }).sort((left, right) => {
    const leftRank = materialDimensionRank(left.material_dimensions);
    const rightRank = materialDimensionRank(right.material_dimensions);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.id.localeCompare(right.id);
  });

  if ((validation?.prompt_injection_findings ?? []).length > 0 || (goalAnalysis?.untrusted_instructions ?? []).length > 0) {
    addReason(reasons, "prompt_injection_detected", "Untrusted instructions remain present and cannot be promoted into approval content.");
  }
  if ((validation?.missing_items ?? []).length > 0) {
    addReason(reasons, "missing_items_detected", "The validation record still reports missing material items.");
  }
  if ((goalAnalysis?.conflicts ?? []).length > 0 && (validation?.verdict ?? "valid") !== "valid") {
    addReason(reasons, "validation_not_valid", "Conflicts remain unresolved in the validation pass.");
  }

  const claimIds = new Set(classifiedClaims.map((claim) => claim.id));
  const decisionIds = new Set(materialDecisions.map((decision) => decision.id));
  const traceability = [
    ...(goalAnalysis?.refined_outcome ? [{ item_id: goalAnalysis.refined_outcome.id, item_kind: "section-item", source_refs: sourceRefsOf(goalAnalysis.refined_outcome) }] : []),
    ...areaDecisions.map((decision) => ({ item_id: decision.id, item_kind: "area", source_refs: decision.source_refs })),
    ...classifiedClaims.map((claim) => ({ item_id: claim.id, item_kind: "claim", source_refs: claim.source_refs })),
    ...(goalAnalysis?.boundaries ?? []).map((boundary) => ({ item_id: boundary.id, item_kind: "section-item", source_refs: sourceRefsOf(boundary) })),
    ...(goalAnalysis?.non_goals ?? []).map((item) => ({ item_id: item.id, item_kind: "non-goal", source_refs: sourceRefsOf(item) })),
    ...materialDecisions.map((decision) => ({ item_id: decision.id, item_kind: "decision", source_refs: decision.source_refs })),
    ...(goalAnalysis?.acceptance_criteria ?? []).map((criterion) => ({ item_id: criterion.id, item_kind: "criterion", source_refs: sourceRefsOf(criterion) })),
    ...(goalAnalysis?.conflicts ?? []).map((finding) => ({ item_id: finding.id, item_kind: "blocker", source_refs: sourceRefsOf(finding) }))
  ].filter((entry) => Array.isArray(entry.source_refs) && entry.source_refs.length > 0);

  const omittedCount = Math.max(0, claims.length - classifiedClaims.length);
  const bundleResult = {
    ...bundle,
    refined_outcome: goalAnalysis?.refined_outcome ?? null,
    boundaries: Array.isArray(goalAnalysis?.boundaries) ? goalAnalysis.boundaries : [],
    area_decisions: areaDecisions,
    classified_claims: classifiedClaims,
    assumptions: Array.isArray(goalAnalysis?.assumptions) ? goalAnalysis.assumptions : [],
    conflicts: [
      ...(Array.isArray(goalAnalysis?.conflicts) ? goalAnalysis.conflicts : []),
      ...((validation?.prompt_injection_findings ?? []).map((finding, index) => ({
        id: finding.id ?? `prompt-injection-${index + 1}`,
        kind: "untrusted-instruction",
        summary: finding.summary ?? String(finding.text ?? "prompt injection"),
        material_dimensions: finding.material_dimensions ?? ["acceptance-criterion"],
        source_refs: sourceRefsOf(finding)
      })))
    ],
    non_goals: Array.isArray(goalAnalysis?.non_goals) ? goalAnalysis.non_goals : [],
    material_decisions: materialDecisions,
    acceptance_criteria: Array.isArray(goalAnalysis?.acceptance_criteria) ? goalAnalysis.acceptance_criteria : [],
    traceability,
    blocking_ids: unique([
      ...(validation?.missing_items ?? []).map((item) => item.id),
      ...(validation?.prompt_injection_findings ?? []).map((item) => item.id),
      ...areaDecisions.filter((decision) => decision.status === "gap" || decision.status === "conflict").map((decision) => decision.id),
      ...classifiedClaims.filter((claim) => claim.status === "conflict" || claim.status === "unverified").map((claim) => claim.id),
      ...materialDecisions.filter((decision) => (validation?.question_checks ?? []).find((check) => check.question_id === decision.id && check.complete !== true)).map((decision) => decision.id),
      ...(goalAnalysis?.questions ?? []).filter((question) => !questionChecks.has(question.id)).map((question) => question.id),
      ...(goalAnalysis?.questions ?? []).length > 0 && reasons.some((reason) => reason.code === "validator_invocation_reused") ? ["validator-invocation"] : []
    ]),
    omitted_count: omittedCount,
    verdict: reasons.length === 0 ? "ready" : "question-blocked",
    policy_version_sha256: POLICY_VERSION_SHA256
  };

  if (bundleResult.verdict === "ready") {
    bundleResult.blocking_ids = [];
    bundleResult.omitted_count = 0;
  }

  return {
    ready: bundleResult.verdict === "ready",
    reasons,
    bundle: bundleResult,
    claim_ids: [...claimIds],
    decision_ids: [...decisionIds]
  };
}
