/**
 * Draft Phase 1 products from static onboarding.
 * Honest: system-model stays needs-evidence; design-strategy stays proposed.
 * Never claims complete/approved without live evidence and a human gate.
 */

import { strategyArtifactHash } from "../../core/src/trusted-context.mjs";
import { assertContract } from "./contracts.mjs";
import { hashContract } from "./harness.mjs";

function claimByPrefix(claims, prefix) {
  return (claims ?? []).find((claim) => claim.id === prefix || claim.id.startsWith(`${prefix}`));
}

function hasDomainSignal(claims, domain) {
  return (claims ?? []).some((claim) => claim.domain === domain && claim.status !== "not-covered");
}

function inferStoreKind(plan, snapshot) {
  const services = (snapshot?.detected?.services ?? []).map((item) => String(item).toLowerCase());
  const frameworks = (snapshot?.detected?.frameworks ?? []).map((item) => String(item).toLowerCase());
  const keys = [...(snapshot?.environment?.declared_keys ?? []), ...(plan?.summary?.environment_keys ?? [])].map((item) => String(item).toLowerCase());
  const haystack = [...services, ...frameworks, ...keys].join(" ");
  if (/postgres|postgresql/.test(haystack)) return "PostgreSQL";
  if (/mysql/.test(haystack)) return "MySQL";
  if (/sqlite/.test(haystack)) return "SQLite";
  if (/mongo/.test(haystack)) return "MongoDB";
  if (/redis/.test(haystack)) return "Redis";
  if (hasDomainSignal(plan.claims, "database")) return "detected-database";
  return null;
}

/**
 * Build a schema-valid draft system-model from static detection.
 */
export function buildDraftSystemModelFromOnboardingPlan(plan, { snapshot = null } = {}) {
  if (!plan?.repository_identity || !plan.commit_sha) {
    throw new Error("Draft system model requires a committed onboarding plan.");
  }

  const claims = plan.claims ?? [];
  const components = [];
  if (hasDomainSignal(claims, "frontend") || (snapshot?.detected?.platforms ?? []).includes("web")) {
    components.push({ id: "component-frontend", kind: "frontend", owner: "frontend" });
  }
  if (hasDomainSignal(claims, "backend") || (snapshot?.detected?.platforms ?? []).includes("api")) {
    components.push({ id: "component-backend", kind: "backend", owner: "backend" });
  }
  if (hasDomainSignal(claims, "database")) {
    components.push({ id: "component-database", kind: "database", owner: "database" });
  }
  if (components.length === 0) {
    components.push({ id: "component-repository", kind: "automation", owner: "repository" });
  }

  const stores = [];
  const storeKind = inferStoreKind(plan, snapshot);
  if (storeKind) {
    stores.push({
      id: "store-primary",
      kind: storeKind,
      disposable_test_available: false
    });
  }

  const trust_boundaries = [];
  const frontend = components.find((item) => item.kind === "frontend");
  const backend = components.find((item) => item.kind === "backend");
  if (frontend && backend) {
    trust_boundaries.push({
      id: "boundary-frontend-backend",
      from_component_id: frontend.id,
      to_component_id: backend.id,
      authentication: "unverified",
      authorization: "unverified"
    });
  }

  const unknowns = [
    "Entity inventory is not yet derived from schema or migrations.",
    "Role and permission matrix is not yet modeled from code or runtime.",
    "End-to-end feature flows are not yet traced with evidence.",
    "Invariants and disposable-store proof are not yet established."
  ];
  if (!stores.length) unknowns.unshift("No durable store was confidently classified from static signals.");
  if (!trust_boundaries.length) unknowns.push("No trust boundary could be inferred from detected components.");

  const risks = [];
  for (const claim of claims.filter((item) => item.status === "conflict").slice(0, 8)) {
    risks.push({
      id: `risk-${claim.id}`.slice(0, 128),
      classification: "goal-blocking",
      summary: claim.summary,
      evidence_refs: (claim.evidence_refs ?? []).slice(0, 8)
    });
  }
  for (const claim of claims.filter((item) => ["not-covered", "unverified"].includes(item.status) && ["database", "security", "strategy"].includes(item.domain)).slice(0, 8)) {
    risks.push({
      id: `risk-gap-${claim.id}`.slice(0, 128),
      classification: "unverified",
      summary: claim.summary,
      evidence_refs: (claim.evidence_refs ?? []).slice(0, 8)
    });
  }

  const body = {
    schema_version: 1,
    repository_identity: plan.repository_identity,
    commit_sha: plan.commit_sha,
    components,
    stores,
    entities: [],
    trust_boundaries,
    roles: [],
    flows: [],
    invariants: [],
    risks,
    unknowns,
    verdict: "needs-evidence"
  };
  return {
    ...body,
    id: `system-model-draft-${hashContract(body).slice(0, 24)}`
  };
}

/**
 * Build a schema-valid proposed design-strategy (never approved here).
 */
export function buildProposedDesignStrategyFromOnboardingPlan(plan, { snapshot = null } = {}) {
  if (!plan?.repository_identity || !plan.commit_sha) {
    throw new Error("Proposed design strategy requires a committed onboarding plan.");
  }

  const platforms = snapshot?.detected?.platforms ?? [];
  const frameworks = snapshot?.detected?.frameworks ?? [];
  const stackNote = [...platforms, ...frameworks].slice(0, 6).join(", ") || "detected repository stack";

  const area = (principle) => ({
    principles: [principle],
    enforcement: ["human strategy review before approval", "alignment brief must surface drift"]
  });

  const draft = {
    schema_version: 1,
    repository_identity: plan.repository_identity,
    commit_sha: plan.commit_sha,
    strategy_version: 1,
    status: "proposed",
    frontend: area("Prefer reusable UI modules and explicit user-visible outcomes before styling churn."),
    backend: area("Keep API contracts, authorization, and failure paths explicit at module boundaries."),
    data: area("Treat schema, migrations, constraints, and disposable test data as first-class proof surfaces."),
    security: area("Model trust boundaries and roles before expanding privileged behavior."),
    testing: area("Climb the proof ladder: unit → service → browser/runtime evidence bound to the same revision."),
    decisions: [
      {
        id: "decision-proof-before-ready",
        rule: "Phase 1 understanding cannot become ready from static detection alone; live evidence and an approved strategy are required.",
        rationale: `Static signals only sketched ${stackNote}; claiming readiness would hide unverified database, security, and flow gaps.`,
        applies_to: ["**/*"],
        source_refs: ["onboarding-plan", "repository-understanding-baseline"],
        enforcement: "understanding-policy + human strategy gate"
      }
    ],
    exceptions: []
  };

  const withId = {
    ...draft,
    id: `design-strategy-draft-${hashContract(draft).slice(0, 24)}`
  };
  return {
    ...withId,
    artifact_sha256: strategyArtifactHash(withId)
  };
}

export async function createValidatedPhase1DraftsFromOnboardingPlan(plan, options = {}) {
  const systemModel = buildDraftSystemModelFromOnboardingPlan(plan, options);
  const strategy = buildProposedDesignStrategyFromOnboardingPlan(plan, options);
  await assertContract("system-model", systemModel);
  await assertContract("design-strategy", strategy);
  return { systemModel, strategy };
}
