/**
 * Turn a read-only onboarding plan into a revision-bound
 * repository-understanding-baseline — an auditable Phase 1 product,
 * not a hand-written stub.
 */

import { assertContract } from "./contracts.mjs";
import { hashContract } from "./harness.mjs";

const PROVED = new Set(["code-confirmed", "test-confirmed", "runtime-observed"]);
const PATHISH = /\/|\|\.(?:py|ts|tsx|js|jsx|json|yml|yaml|toml|md|lock|txt|sql)$/i;

function severityFor(status, domain) {
  if (status === "conflict") return "blocking";
  if (["not-covered", "unverified"].includes(status) && ["database", "security", "runtime", "strategy"].includes(domain)) {
    return "blocking";
  }
  if (["not-covered", "unverified", "detected"].includes(status)) return "warning";
  return "info";
}

function affectedPaths(evidenceRefs = []) {
  return [...new Set(
    evidenceRefs
      .map((ref) => String(ref ?? "").trim())
      .filter((ref) => PATHISH.test(ref) && !ref.startsWith("readiness:") && ref !== "external-project-config")
  )].slice(0, 32);
}

function sourceRefs(evidenceRefs = [], claimId) {
  const refs = [...new Set((evidenceRefs ?? []).map((ref) => String(ref)).filter(Boolean))];
  if (refs.length === 0) return [`claim:${claimId}`];
  return refs.slice(0, 32);
}

function mapClaim(claim) {
  return {
    id: claim.id,
    domain: claim.domain,
    statement: claim.summary,
    status: claim.status,
    severity: severityFor(claim.status, claim.domain),
    source_refs: sourceRefs(claim.evidence_refs, claim.id),
    evidence_refs: [...(claim.evidence_refs ?? [])],
    affected_paths: affectedPaths(claim.evidence_refs)
  };
}

function deriveConflicts(claims) {
  const byDomain = new Map();
  for (const claim of claims.filter((item) => item.status === "conflict")) {
    const list = byDomain.get(claim.domain) ?? [];
    list.push(claim.id);
    byDomain.set(claim.domain, list);
  }
  const conflicts = [];
  for (const [domain, ids] of byDomain) {
    if (ids.length < 2) {
      // Single conflict claim: pair with a synthetic sibling from same domain if present
      const peers = claims.filter((c) => c.domain === domain && c.id !== ids[0]).map((c) => c.id);
      if (peers.length === 0) continue;
      conflicts.push({
        id: `conflict-${domain}-1`,
        domain,
        claim_ids: [ids[0], peers[0]],
        severity: "blocking",
        status: "open",
        summary: `Conflict reported in ${domain}; sources disagree or declaration is inconsistent.`
      });
      continue;
    }
    conflicts.push({
      id: `conflict-${domain}-1`,
      domain,
      claim_ids: ids.slice(0, 8),
      severity: "blocking",
      status: "open",
      summary: `Open conflict among ${ids.length} ${domain} claims.`
    });
  }
  return conflicts;
}

function requiredDomainsFrom(plan) {
  const fromCoverage = (plan.coverage ?? [])
    .filter((item) => item.status !== "not-applicable")
    .map((item) => item.domain);
  const fromClaims = (plan.claims ?? []).map((claim) => claim.domain);
  const domains = [...new Set([...fromCoverage, ...fromClaims])];
  if (domains.length === 0) domains.push("repository");
  return domains.sort();
}

function baselineVerdict(plan) {
  if (!plan.commit_sha || plan.verdict === "blocked") return "blocked";
  if ((plan.claims ?? []).some((claim) => claim.status === "conflict")) return "conflict";
  return "needs-evidence";
}

/**
 * Build a schema-valid repository-understanding-baseline from an onboarding plan.
 * Honest: never marks ready from static detection alone.
 */
export function buildRepositoryUnderstandingBaselineFromOnboardingPlan(plan, {
  capturedAt = new Date().toISOString()
} = {}) {
  if (!plan?.repository_identity) throw new Error("Understanding baseline requires an onboarding plan with repository_identity.");
  if (!plan.commit_sha) throw new Error("Understanding baseline requires a committed revision on the onboarding plan.");

  const claims = (plan.claims ?? []).map(mapClaim);
  if (claims.length === 0) throw new Error("Understanding baseline requires at least one claim.");

  const pendingStrategyBody = {
    schema_version: 1,
    id: "strategy-pending",
    kind: "design-strategy-placeholder",
    repository_identity: plan.repository_identity,
    commit_sha: plan.commit_sha,
    status: "proposed",
    summary: "No developer-approved design strategy artifact yet; Phase 1 baseline records the gap honestly."
  };
  const strategyHash = hashContract(pendingStrategyBody);

  const body = {
    schema_version: 1,
    repository_identity: plan.repository_identity,
    commit_sha: plan.commit_sha,
    captured_at: capturedAt,
    required_domains: requiredDomainsFrom(plan),
    claims,
    conflicts: deriveConflicts(claims),
    models: {
      system_model_id: "system-model-pending",
      database_covered: false,
      security_covered: false,
      feature_flows_covered: false
    },
    strategy: {
      strategy_id: "strategy-pending",
      version: 1,
      status: "proposed",
      artifact_sha256: strategyHash
    },
    verdict: baselineVerdict(plan)
  };

  const baseline = {
    ...body,
    id: `understanding-baseline-${hashContract(body).slice(0, 24)}`
  };
  return baseline;
}

/**
 * Compact, auditable markdown for humans (and dogfood docs).
 */
export function formatAuditableUnderstandingBrief(baseline, {
  onboardingPlan = null,
  runId = null,
  generatedNote = null
} = {}) {
  const summary = onboardingPlan?.summary;
  const lines = [
    "# Repository Understanding Brief (Phase 1)",
    "",
    generatedNote ? `- Note: ${generatedNote}` : null,
    runId ? `- Goal run: \`${runId}\`` : null,
    `- Baseline id: \`${baseline.id}\``,
    `- Repository: \`${baseline.repository_identity}\``,
    `- Revision: \`${baseline.commit_sha}\``,
    `- Captured: ${baseline.captured_at}`,
    `- Verdict: **${baseline.verdict}** (static Phase 1 never claims ready without runtime/test proof)`,
    "",
    "## Required domains",
    "",
    baseline.required_domains.map((domain) => `- ${domain}`).join("\n"),
    "",
    "## Claims by domain",
    ""
  ].filter((line) => line !== null);

  const byDomain = new Map();
  for (const claim of baseline.claims) {
    const list = byDomain.get(claim.domain) ?? [];
    list.push(claim);
    byDomain.set(claim.domain, list);
  }
  for (const domain of [...byDomain.keys()].sort()) {
    lines.push(`### ${domain}`, "");
    for (const claim of byDomain.get(domain)) {
      const paths = claim.affected_paths.length ? ` · paths: ${claim.affected_paths.slice(0, 4).join(", ")}` : "";
      lines.push(`- \`${claim.id}\` · **${claim.status}** · ${claim.severity}: ${claim.statement}${paths}`);
    }
    lines.push("");
  }

  if (baseline.conflicts.length) {
    lines.push("## Open conflicts", "");
    for (const conflict of baseline.conflicts) {
      lines.push(`- \`${conflict.id}\` (${conflict.domain}, ${conflict.severity}): ${conflict.summary}`);
    }
    lines.push("");
  }

  lines.push(
    "## Model / strategy coverage (honest gaps)",
    "",
    `- System model: \`${baseline.models.system_model_id}\` · database=${baseline.models.database_covered} · security=${baseline.models.security_covered} · feature_flows=${baseline.models.feature_flows_covered}`,
    `- Strategy: \`${baseline.strategy.strategy_id}\` v${baseline.strategy.version} · ${baseline.strategy.status}`,
    ""
  );

  if (summary) {
    lines.push(
      "## Onboarding rollup",
      "",
      `- Proved ${summary.proved_claims}/${summary.total_claims} · unresolved ${summary.unresolved_claims} · conflicts ${summary.conflict_claims}`,
      `- Priority domains: ${(summary.priority_domains ?? []).slice(0, 8).join(", ") || "none"}`,
      ""
    );
  }

  if (onboardingPlan?.blockers?.length) {
    lines.push("## Highest-priority blockers", "");
    for (const blocker of onboardingPlan.blockers.slice(0, 8)) {
      lines.push(`- ${blocker.summary}`);
    }
    lines.push("");
  }

  lines.push(
    "## Audit notes",
    "",
    "- This brief is derived from the revision-bound onboarding plan + repository snapshot.",
    "- Detection and documentation are not promoted to runtime proof.",
    "- `system-model-pending` / `strategy-pending` mark missing Phase 1 products that still need evidence-backed modeling and human approval.",
    ""
  );
  return lines.join("\n");
}

export async function createValidatedUnderstandingBaselineFromOnboardingPlan(plan, options = {}) {
  const baseline = buildRepositoryUnderstandingBaselineFromOnboardingPlan(plan, options);
  await assertContract("repository-understanding-baseline", baseline);
  return baseline;
}
