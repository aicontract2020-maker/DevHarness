import { isTrustedEvaluationContext } from "./trusted-context.mjs";

function addReason(reasons, code, message, refs = []) {
  reasons.push({ code, message, refs });
}

function evidenceById(evidence) {
  return new Map(evidence.map((record) => [record.id, record]));
}

function isIndependent(actorId, implementationActorIds) {
  return !implementationActorIds.has(actorId);
}

export function evaluateDeliveryReadiness({
  run,
  criteria,
  evidence = [],
  reviewVerdicts,
  findings,
  implementationActorIds = [],
  trustContext,
  profile = "full"
}) {
  const reasons = [];
  const docsOnly = profile === "docs-only";
  const trusted = isTrustedEvaluationContext(trustContext);
  if (!trusted && !(docsOnly && (criteria?.length ?? 0) === 0)) {
    addReason(reasons, "trusted_delivery_context_missing", "Delivery readiness requires Supervisor-verified evidence; caller evidence arrays are ignored.");
  }
  void evidence;
  const trustedEvidence = trusted ? trustContext.evidence : [];
  const evidenceIndex = evidenceById(trustedEvidence);
  const implementers = new Set(implementationActorIds);

  if (run.gates?.scope?.status !== "approved") {
    addReason(reasons, "scope_not_approved", "The approved scope gate is missing.");
  }

  if (!run.current_head_sha) {
    addReason(reasons, "head_missing", "The run has no current commit to bind evidence to.");
  }

  for (const criterion of criteria) {
    if (criterion.blocking && criterion.verdict.status !== "pass") {
      addReason(
        reasons,
        "blocking_criterion_not_passed",
        `Blocking criterion ${criterion.id} is ${criterion.verdict.status}.`,
        [criterion.id]
      );
      continue;
    }

    if (criterion.verdict.status !== "pass") {
      continue;
    }

    if (criterion.verdict.evidence_refs.length === 0) {
      addReason(
        reasons,
        "criterion_has_no_evidence",
        `Passing criterion ${criterion.id} has no evidence.`,
        [criterion.id]
      );
      continue;
    }

    const criterionEvidence = criterion.verdict.evidence_refs
      .map((id) => evidenceIndex.get(id))
      .filter(Boolean);

    for (const evidenceId of criterion.verdict.evidence_refs) {
      if (!evidenceIndex.has(evidenceId)) {
        addReason(
          reasons,
          "evidence_missing",
          `Criterion ${criterion.id} references missing evidence ${evidenceId}.`,
          [criterion.id, evidenceId]
        );
      }
    }

    const usableEvidence = criterionEvidence.filter(
      (record) =>
        record.run_id === run.id &&
        record.criterion_ids.includes(criterion.id) &&
        record.observation.result === "pass" &&
        record.subject.commit_sha === run.current_head_sha
    );

    if (usableEvidence.length === 0) {
      addReason(
        reasons,
        "no_current_passing_evidence",
        `Criterion ${criterion.id} has no passing evidence for the current head.`,
        [criterion.id]
      );
      continue;
    }

    const actualTypes = new Set(usableEvidence.map((record) => record.type));
    for (const requiredType of criterion.proof.evidence_types) {
      if (!actualTypes.has(requiredType)) {
        addReason(
          reasons,
          "required_evidence_type_missing",
          `Criterion ${criterion.id} is missing ${requiredType} evidence for the current head.`,
          [criterion.id]
        );
      }
    }

    if (
      criterion.proof.independent &&
      !usableEvidence.some((record) => isIndependent(record.producer.id, implementers))
    ) {
      addReason(
        reasons,
        "independent_verification_missing",
        `Criterion ${criterion.id} was not verified independently of its implementers.`,
        [criterion.id]
      );
    }
  }

  if (!docsOnly) {
    const currentReviews = reviewVerdicts.filter(
      (review) => review.head_sha === run.current_head_sha && review.status === "pass"
    );

    if (currentReviews.length === 0) {
      addReason(reasons, "current_review_missing", "No passing review exists for the current head.");
    } else if (!currentReviews.some((review) => isIndependent(review.reviewer.id, implementers))) {
      addReason(
        reasons,
        "independent_review_missing",
        "No passing review was produced independently of the implementation agents."
      );
    }
    const trustedReviewIds = new Set(trustedEvidence
      .filter((record) =>
        record.type === "review-report" &&
        record.run_id === run.id &&
        record.subject?.commit_sha === run.current_head_sha &&
        record.observation?.result === "pass"
      )
      .map((record) => record.observation?.data?.review_verdict_id)
      .filter(Boolean));
    if (!currentReviews.some((review) => trustedReviewIds.has(review.id))) {
      addReason(reasons, "trusted_review_evidence_missing", "No Supervisor-verified review report is bound to a passing current-head verdict.");
    }
  }

  for (const finding of findings) {
    if (finding.head_sha !== run.current_head_sha || finding.severity !== "blocking") {
      continue;
    }

    if (finding.status === "open") {
      addReason(
        reasons,
        "blocking_review_finding_open",
        `Blocking review finding ${finding.id} is unresolved.`,
        [finding.id]
      );
    }

    if (
      finding.status === "accepted_risk" &&
      finding.resolution?.resolved_by?.kind !== "human"
    ) {
      addReason(
        reasons,
        "blocking_risk_not_human_accepted",
        `Blocking finding ${finding.id} requires explicit human risk acceptance.`,
        [finding.id]
      );
    }
  }

  return {
    ready: reasons.length === 0,
    reasons
  };
}
