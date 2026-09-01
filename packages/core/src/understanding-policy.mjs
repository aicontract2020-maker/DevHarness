import { evaluateDesignStrategy } from "./strategy-policy.mjs";
import { evaluateSystemModel } from "./system-model-policy.mjs";
import { isTrustedEvaluationContext, strategyArtifactHash } from "./trusted-context.mjs";

const LIVE_DOMAINS = new Set(["runtime", "frontend", "backend", "database", "security", "deployment", "automation"]);
const PROVED = new Set(["code-confirmed", "test-confirmed", "runtime-observed"]);
const LIVE_PROVED = new Set(["test-confirmed", "runtime-observed"]);
const STATUS_EVIDENCE = {
  "code-confirmed": new Set(["command-output", "filesystem-state", "review-report"]),
  "test-confirmed": new Set(["test-result"]),
  "runtime-observed": new Set(["browser-snapshot", "screenshot", "console", "network", "database-state", "filesystem-state", "performance-measurement"])
};

function reason(reasons, code, summary, subject) {
  reasons.push({ code, summary, ...(subject ? { subject } : {}) });
}

function sameMembers(left, right) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function currentEvidence(record, baseline) {
  return record?.subject?.repository_identity === baseline.repository_identity && record.subject.commit_sha === baseline.commit_sha && ["pass", "observed"].includes(record.observation?.result) && (record.artifacts ?? []).length > 0;
}

export function evaluateUnderstandingBaseline(baseline, { trustContext, systemModels = [], strategies = [] } = {}) {
  const reasons = [];
  const trusted = isTrustedEvaluationContext(trustContext);
  const inventory = trusted ? trustContext.inventory : null;
  const evidence = trusted ? trustContext.evidence : [];
  const currentHeadSha = inventory?.currentHeadSha;
  const expectedDomains = inventory?.expectedDomains;
  if (!trusted) reason(reasons, "trusted_understanding_context_missing", "Repository understanding can become ready only through the trusted discovery, evidence and approval boundary.");
  if (inventory && baseline?.repository_identity !== inventory.repositoryIdentity) reason(reasons, "baseline_repository_mismatch", "Understanding baseline repository does not match live discovery.");
  if (inventory?.dirty) reason(reasons, "dirty_workspace_unbound", "Understanding readiness requires a clean committed workspace; uncommitted content is not bound to the evidence revision.");
  const claims = Array.isArray(baseline?.claims) ? baseline.claims : [];
  const requiredDomains = Array.isArray(baseline?.required_domains) ? baseline.required_domains : [];
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));

  if (!currentHeadSha || !baseline?.commit_sha || baseline.commit_sha !== currentHeadSha) reason(reasons, "baseline_stale", "The understanding baseline is not bound to the current repository revision.");
  if (!Array.isArray(expectedDomains) || !sameMembers([...requiredDomains].sort(), [...expectedDomains].sort())) reason(reasons, "required_domains_mismatch", "Required domains must be derived from the current repository and goal impact.");
  if (baseline?.verdict !== "ready") reason(reasons, "baseline_verdict_not_ready", `Baseline artifact verdict is ${baseline?.verdict ?? "missing"}.`);

  for (const domain of requiredDomains) {
    const domainClaims = claims.filter((claim) => claim.domain === domain);
    if (domainClaims.length === 0) {
      reason(reasons, "domain_not_covered", `Required domain ${domain} has no claims.`, domain);
      continue;
    }
    if (!domainClaims.some((claim) => PROVED.has(claim.status))) reason(reasons, "domain_unproved", `Required domain ${domain} has no evidence-backed claim.`, domain);
    if (LIVE_DOMAINS.has(domain) && !domainClaims.some((claim) => LIVE_PROVED.has(claim.status))) reason(reasons, "live_domain_unproved", `Live domain ${domain} has not been test-confirmed or runtime-observed.`, domain);
    for (const claim of domainClaims) {
      if (claim.status === "conflict" || (["unverified", "not-covered"].includes(claim.status) && claim.severity === "blocking")) reason(reasons, "blocking_claim", `Required domain ${domain} retains blocking claim ${claim.id}.`, claim.id);
    }
  }

  for (const claim of claims) {
    if (!PROVED.has(claim.status)) continue;
    if (!Array.isArray(claim.evidence_refs) || claim.evidence_refs.length === 0) {
      reason(reasons, "claim_without_evidence", `Claim ${claim.id} has a proof status without evidence.`, claim.id);
      continue;
    }
    const records = claim.evidence_refs.map((id) => evidenceById.get(id));
    if (records.some((record) => !currentEvidence(record, baseline))) reason(reasons, "claim_evidence_invalid", `Claim ${claim.id} references missing, stale or failed evidence.`, claim.id);
    const allowed = STATUS_EVIDENCE[claim.status];
    if (!records.some((record) => allowed?.has(record?.type))) reason(reasons, "claim_evidence_type_invalid", `Claim ${claim.id} lacks evidence appropriate for ${claim.status}.`, claim.id);
    if (claim.domain === "database" && claim.status === "runtime-observed" && !records.some((record) => record?.type === "database-state")) reason(reasons, "database_evidence_missing", `Database claim ${claim.id} requires database-state evidence.`, claim.id);
    if (claim.domain === "frontend" && claim.status === "runtime-observed" && !records.some((record) => ["browser-snapshot", "screenshot"].includes(record?.type))) reason(reasons, "frontend_evidence_missing", `Frontend claim ${claim.id} requires browser or simulator surface evidence.`, claim.id);
  }

  for (const conflict of baseline?.conflicts ?? []) {
    const conflictClaims = (conflict.claim_ids ?? []).map((id) => claimById.get(id));
    if (conflictClaims.some((claim) => !claim) || conflictClaims.some((claim) => claim.domain !== conflict.domain)) reason(reasons, "conflict_reference_invalid", `Conflict ${conflict.id} has missing or cross-domain claim references.`, conflict.id);
    if (conflict.status === "open" && requiredDomains.includes(conflict.domain)) reason(reasons, conflict.severity === "blocking" ? "blocking_conflict" : "open_conflict", `Conflict ${conflict.id} is unresolved in required domain ${conflict.domain}.`, conflict.id);
  }

  const systemModel = systemModels.find((model) => model.id === baseline?.models?.system_model_id);
  if (!systemModel) reason(reasons, "system_model_missing", "The referenced system model artifact is unavailable.", baseline?.models?.system_model_id);
  else {
    const result = evaluateSystemModel(systemModel, { trustContext });
    for (const item of result.reasons) reason(reasons, `system_${item.code}`, item.summary, item.subject);
    if (systemModel.verdict !== "complete") reason(reasons, "system_model_incomplete", "The referenced system model is not complete.", systemModel.id);
  }
  const databaseCovered = Boolean(systemModel && (systemModel.components ?? []).some((component) => component.kind === "database") && (systemModel.stores ?? []).length > 0 && (systemModel.entities ?? []).length > 0);
  const securityCovered = Boolean(systemModel && (systemModel.roles ?? []).length > 0 && (systemModel.trust_boundaries ?? []).length > 0);
  const featureFlowsCovered = Boolean(systemModel && (systemModel.flows ?? []).some((flow) => (flow.steps ?? []).some((step) => (step.reads ?? []).length > 0 || (step.writes ?? []).length > 0 || (step.calls ?? []).length > 0)));
  if (baseline?.models?.database_covered !== databaseCovered) reason(reasons, "database_coverage_mismatch", "Database coverage must be computed from the referenced system model.", "database");
  if (baseline?.models?.security_covered !== securityCovered) reason(reasons, "security_coverage_mismatch", "Security coverage must be computed from roles and trust boundaries.", "security");
  if (baseline?.models?.feature_flows_covered !== featureFlowsCovered) reason(reasons, "feature_flow_coverage_mismatch", "Feature-flow coverage must be computed from effectful system flows.");
  if ((expectedDomains ?? []).includes("database") && !databaseCovered) reason(reasons, "database_model_missing", "The database domain lacks an explicit system model.", "database");
  if ((expectedDomains ?? []).includes("security") && !securityCovered) reason(reasons, "security_model_missing", "The security domain lacks trust-boundary and role coverage.", "security");
  if (!featureFlowsCovered) reason(reasons, "feature_flow_missing", "End-to-end feature flows are not covered by the system model.");

  const strategy = strategies.find((item) => item.id === baseline?.strategy?.strategy_id);
  const actualStrategyHash = strategy ? strategyArtifactHash(strategy) : null;
  if (!strategy || strategy.artifact_sha256 !== actualStrategyHash || actualStrategyHash !== baseline?.strategy?.artifact_sha256 || strategy.strategy_version !== baseline?.strategy?.version || strategy.status !== baseline?.strategy?.status) reason(reasons, "strategy_artifact_missing", "The referenced strategy content, version, status and hash are unavailable or inconsistent.", baseline?.strategy?.strategy_id);
  else {
    const result = evaluateDesignStrategy(strategy, { trustContext });
    for (const item of result.reasons) reason(reasons, `strategy_${item.code}`, item.summary, item.subject);
  }
  if (baseline?.strategy?.status !== "approved" || strategy?.status !== "approved") reason(reasons, "strategy_not_approved", "Both the referenced strategy and baseline require an independent approved human gate receipt.", baseline?.strategy?.strategy_id);

  return { ready: reasons.length === 0, reasons };
}
