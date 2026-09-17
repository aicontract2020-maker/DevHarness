/**
 * Honest Phase 1 reconciliation: sync claims with modeled coverage, refresh
 * system-model unknowns/risks/disposable flags, and promote verdicts only when
 * remaining gates are actually clear.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { hashContract } from "./harness.mjs";
import { looksLikeEvidenceId, rehashBaseline, rehashSystemModel } from "./apply-evidence-to-baseline.mjs";

function repositoryRootFromSnapshot(snapshot) {
  const uri = snapshot?.repository?.root_uri;
  if (!uri) return null;
  if (uri.startsWith("file://")) return decodeURIComponent(uri.slice("file://".length));
  return uri;
}

function walkLimited(root, { maxFiles = 200 } = {}) {
  const out = [];
  if (!root || !existsSync(root)) return out;
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git" || name === "venv" || name === ".venv" || name === "dist" || name === "build") continue;
      const full = path.join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

/**
 * True when the repo has an in-memory / disposable test database surface.
 */
export function detectDisposableTestStore(repositoryRoot) {
  if (!repositoryRoot) return false;
  const conftestFiles = [];
  const otherCandidates = [];
  const stack = [repositoryRoot];
  while (stack.length && (conftestFiles.length + otherCandidates.length) < 250) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (["node_modules", ".git", "venv", ".venv", "dist", "build", "coverage", ".next", "out"].includes(name)) continue;
      const full = path.join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      const normalized = full.replaceAll("\\", "/");
      if (/(^|\/)conftest\.py$/i.test(normalized)) conftestFiles.push(full);
      else if (/\/tests?\/.*\.(py|ts|js|mjs)$/i.test(normalized) || /(^|\/)pytest\.ini$/i.test(normalized)) {
        otherCandidates.push(full);
      }
    }
  }
  for (const file of [...conftestFiles, ...otherCandidates]) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (/sqlite:\/\/\/:memory:|TEST_DATABASE_URL\s*=\s*["']sqlite|create_engine\(\s*["']sqlite|StaticPool|in-memory SQLite|disposable.?test/i.test(text)) {
      return true;
    }
  }
  return false;
}

function severityFor(status, domain) {
  if (status === "conflict") return "blocking";
  if (["not-covered", "unverified"].includes(status) && ["database", "security", "runtime", "strategy"].includes(domain)) {
    return "blocking";
  }
  if (["not-covered", "unverified", "detected"].includes(status)) return "warning";
  return "info";
}

/**
 * Upgrade not-covered claims when the draft model already covers them.
 */
export function reconcileBaselineClaimsWithModel(baseline, {
  systemModel = null,
  strategy = null
} = {}) {
  const rolesOk = (systemModel?.roles?.length ?? 0) > 0 && (systemModel?.trust_boundaries?.length ?? 0) > 0;
  const entitiesOk = (systemModel?.entities?.length ?? 0) > 0;
  const strategyApproved = strategy?.status === "approved" || baseline?.strategy?.status === "approved";

  let changed = false;
  const claims = baseline.claims.map((claim) => {
    if (claim.id === "security-model" && claim.status === "not-covered" && rolesOk) {
      changed = true;
      return {
        ...claim,
        status: "detected",
        severity: severityFor("detected", "security"),
        statement: "Roles and trust boundaries were derived from source gates; runtime authz proof still pending.",
        source_refs: [...new Set([...(claim.source_refs ?? []), "system-model-roles", "system-model-trust-boundaries"])].slice(0, 32)
      };
    }
    if (claim.id === "database-ownership" && claim.status === "not-covered" && entitiesOk) {
      changed = true;
      return {
        ...claim,
        status: "detected",
        severity: severityFor("detected", "database"),
        statement: "Entity inventory was derived from models/migrations; lifecycle ownership still needs live proof.",
        source_refs: [...new Set([...(claim.source_refs ?? []), "system-model-entities"])].slice(0, 32)
      };
    }
    if (claim.id === "design-strategy" && ["not-covered", "detected", "documented"].includes(claim.status) && strategyApproved) {
      changed = true;
      return {
        ...claim,
        status: "detected",
        severity: severityFor("detected", "strategy"),
        statement: "Design strategy was approved by the human strategy gate for this revision; bind live evidence next.",
        source_refs: [...new Set([...(claim.source_refs ?? []), strategy?.id, "strategy-gate"].filter(Boolean))].slice(0, 32)
      };
    }
    return claim;
  });

  if (!changed) return baseline;

  const models = {
    ...baseline.models,
    database_covered: Boolean(systemModel && (systemModel.stores?.length ?? 0) > 0 && entitiesOk),
    security_covered: rolesOk,
    feature_flows_covered: Boolean(systemModel && (systemModel.flows ?? []).some((flow) => (flow.steps ?? []).some((step) => (step.reads ?? []).length > 0 || (step.writes ?? []).length > 0 || (step.calls ?? []).length > 0))),
    system_model_id: systemModel?.id ?? baseline.models.system_model_id
  };

  return rehashBaseline({ ...baseline, models }, claims);
}

/**
 * Refresh disposable flag, risks, unknowns; promote to complete when gates pass.
 */
export function reconcileSystemModelHonesty(model, {
  repositoryRoot = null,
  strategy = null,
  snapshot = null
} = {}) {
  const root = repositoryRoot ?? repositoryRootFromSnapshot(snapshot);
  const disposable = detectDisposableTestStore(root);
  const rolesOk = (model.roles?.length ?? 0) > 0 && (model.trust_boundaries?.length ?? 0) > 0;
  const entitiesOk = (model.entities?.length ?? 0) > 0;
  const flows = model.flows ?? [];
  const flowEvidenceBound = flows.length > 0 && flows.every((flow) =>
    (flow.steps ?? []).every((step) => (step.evidence_refs ?? []).length > 0 && (step.evidence_refs ?? []).every(looksLikeEvidenceId))
  );
  const strategyApproved = strategy?.status === "approved";

  const stores = (model.stores ?? []).map((store) => (
    disposable ? { ...store, disposable_test_available: true } : store
  ));

  const risks = (model.risks ?? []).filter((risk) => {
    if (risk.id === "risk-gap-security-model" && rolesOk) return false;
    if (risk.id === "risk-gap-database-ownership" && entitiesOk) return false;
    // Strategy readiness is enforced on the baseline/strategy artifacts, not the system model.
    if (risk.id === "risk-gap-design-strategy") return false;
    // Constraint/query gaps are claim-level; drop once flow evidence is bound and disposable exists.
    if (disposable && flowEvidenceBound && ["risk-gap-database-constraints", "risk-gap-database-queries"].includes(risk.id)) {
      return false;
    }
    return true;
  });

  const unknowns = [];
  if (!stores.length) unknowns.push("No durable store was confidently classified from static signals.");
  if (!entitiesOk) unknowns.push("Entity inventory could not be derived from SQLAlchemy models or migrations.");
  if (!flows.length) unknowns.push("No critical readiness flow was inferred from /health/ready.");
  if (!rolesOk) unknowns.push("Role and permission matrix could not be derived from USER_ROLES or role gates.");
  if (!disposable) unknowns.push("Disposable test-store support has not been detected.");
  if (flows.length && !flowEvidenceBound) unknowns.push("Flow steps still cite static source paths; live evidence manifests are required.");
  if (!strategyApproved) {
    // Strategy is tracked on the baseline/strategy artifact, not as a model unknown once risks are cleared.
  }

  const canComplete =
    stores.length > 0 &&
    entitiesOk &&
    flows.length > 0 &&
    rolesOk &&
    disposable &&
    flowEvidenceBound &&
    unknowns.length === 0 &&
    !risks.some((risk) => ["goal-blocking", "unverified"].includes(risk.classification));

  const verdict = canComplete ? "complete" : "needs-evidence";

  return rehashSystemModel(model, {
    stores,
    risks,
    unknowns,
    verdict
  });
}

/**
 * If evaluation only fails on baseline_verdict_not_ready, flip verdict to ready.
 */
export function promoteBaselineVerdictIfOnlyMissingReadyFlag(baseline, evaluation) {
  const reasons = evaluation?.verdict?.reasons ?? evaluation?.reasons ?? [];
  const ready = evaluation?.verdict?.ready === true || evaluation?.ready === true;
  if (ready || baseline.verdict === "ready") return baseline;
  const others = reasons.filter((reason) => reason.code !== "baseline_verdict_not_ready");
  if (others.length > 0) return baseline;
  if (reasons.length === 0) return baseline;
  const { id: _omit, ...rest } = baseline;
  const body = { ...rest, verdict: "ready" };
  return {
    ...body,
    id: `understanding-baseline-${hashContract(body).slice(0, 24)}`
  };
}
