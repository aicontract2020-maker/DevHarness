import { createHash } from "node:crypto";

export const LOCAL_READONLY_AREA_ORDER = Object.freeze([
  "repository-bootstrap",
  "frontend",
  "backend",
  "data",
  "security",
  "integration",
  "testing",
  "deployment",
  "automation"
]);

const AREA_TO_DOMAIN = Object.freeze({
  "repository-bootstrap": "repository",
  frontend: "frontend",
  backend: "backend",
  data: "database",
  security: "security",
  integration: "runtime",
  testing: "testing",
  deployment: "deployment",
  automation: "automation"
});

const DEFAULT_EXPECTED_DOMAINS = Object.freeze([
  "frontend",
  "repository",
  "runtime",
  "security",
  "strategy",
  "testing"
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueSorted(values) {
  return [...new Set((values ?? []).filter(Boolean))].sort();
}

export function expectedDomainsFromSnapshot(snapshot) {
  const platforms = new Set(snapshot?.detected?.platforms ?? []);
  const services = (snapshot?.detected?.services ?? []).map((service) => String(service).toLowerCase());
  const frameworks = (snapshot?.detected?.frameworks ?? []).map((framework) => String(framework).toLowerCase());
  const environmentKeys = new Set([
    ...(snapshot?.environment?.declared_keys ?? []),
    ...(snapshot?.environment?.locally_set_keys ?? [])
  ]);
  const databaseRequired = services.some((service) => ["postgresql", "mysql", "sqlite", "mongodb", "redis"].some((name) => service.includes(name)))
    || frameworks.some((framework) => ["prisma", "typeorm", "sequelize", "drizzle", "sqlalchemy", "django"].some((name) => framework.includes(name)))
    || [...environmentKeys].some((key) => /(^|_)(DATABASE|DB|POSTGRES|MYSQL|MONGO|REDIS)(_|$)/.test(key));
  const runtimeRequired = [...platforms].some((platform) => ["web", "api", "cli", "desktop", "mobile"].includes(platform));
  const required = new Set(["repository", "testing", "strategy"]);
  if (runtimeRequired) required.add("runtime");
  if (platforms.has("web")) required.add("frontend");
  if (platforms.has("api") || (platforms.has("web") && databaseRequired)) required.add("backend");
  if (databaseRequired) required.add("database");
  if (runtimeRequired || databaseRequired) required.add("security");
  if ((snapshot?.detected?.deployment_files ?? []).length > 0) required.add("deployment");
  return uniqueSorted([...required]);
}

export function normalizeExpectedDomains(expectedDomains) {
  const values = Array.isArray(expectedDomains) && expectedDomains.length > 0 ? expectedDomains : DEFAULT_EXPECTED_DOMAINS;
  return uniqueSorted(values);
}

export function localReadonlyProducerIds(operationId) {
  const digest = sha256(`local-readonly:${operationId ?? "operation"}`);
  return {
    analysisId: `goal-analysis-local-${digest.slice(0, 24)}`,
    producerInvocationId: `invocation-local-producer-${digest.slice(0, 16)}`,
    validationId: `analysis-validation-local-${digest.slice(0, 20)}`
  };
}

function sourceRef(analysisId, analysisSha256, pointer) {
  return {
    artifact_id: analysisId,
    artifact_sha256: analysisSha256,
    location: { kind: "json", pointer }
  };
}

function areaRequired(area, expectedDomains) {
  const domain = AREA_TO_DOMAIN[area];
  return domain ? expectedDomains.includes(domain) : false;
}

export function buildLocalReadonlyGoalAnalysis({
  operationId,
  expectedDomains,
  analysisId,
  invocationId
} = {}) {
  const domains = normalizeExpectedDomains(expectedDomains);
  const ids = localReadonlyProducerIds(operationId);
  const id = analysisId ?? ids.analysisId;
  const producerInvocationId = invocationId ?? ids.producerInvocationId;
  const analysisSha256 = sha256(`local-readonly-goal-analysis:${id}`);
  const affectedAreas = LOCAL_READONLY_AREA_ORDER.map((area) => {
    const required = areaRequired(area, domains);
    const status = required ? "applicable" : "not-applicable";
    return {
      area,
      proposed_status: status,
      summary: required
        ? `${area} is in scope for this docs-only local-readonly Alignment pass.`
        : `${area} is not required by the trusted inventory for this docs-only local-readonly Alignment pass.`,
      source_refs: [sourceRef(id, analysisSha256, `/affected_areas/${area}`)]
    };
  });
  const claims = LOCAL_READONLY_AREA_ORDER
    .filter((area) => areaRequired(area, domains))
    .map((area) => ({
      id: `claim-${area}`,
      area,
      text: `Local-readonly analysis documented ${area} from existing Alignment artifacts without a Codex model.`,
      proposed_class: "documented",
      source_refs: [sourceRef(id, analysisSha256, `/claims/${area}`)]
    }));
  return {
    schema_version: 1,
    id,
    invocation_id: producerInvocationId,
    operation_id: operationId,
    refined_outcome: {
      id: "outcome-local-readonly-docs",
      text: "Publish a docs-only Alignment Brief from local-readonly analysis without modifying the consumer repository.",
      source_refs: [sourceRef(id, analysisSha256, "/refined_outcome")]
    },
    affected_areas: affectedAreas,
    claims,
    assumptions: [{
      id: "assumption-local-readonly-stub",
      kind: "assumption",
      summary: "This pass uses the DevHarness local-readonly stub adapter, not Codex, and stays docs-only.",
      material_dimensions: ["acceptance-criterion"],
      source_refs: [sourceRef(id, analysisSha256, "/assumptions/0")]
    }],
    conflicts: [],
    boundaries: [{
      id: "boundary-no-consumer-edits",
      text: "Do not edit the consumer repository, including sunrise-cms.",
      source_refs: [sourceRef(id, analysisSha256, "/boundaries/0")]
    }],
    non_goals: [{
      id: "non-goal-no-product-implementation",
      text: "Do not implement product features, merge, or deploy as part of this Alignment pass.",
      source_refs: [sourceRef(id, analysisSha256, "/non_goals/0")]
    }],
    questions: [],
    acceptance_criteria: [{
      id: "criterion-local-readonly-brief",
      given: "A docs-only Goal Run has completed local-readonly analysis-validation.",
      when: "continue publishes the local-readonly Alignment artifacts.",
      then: "A reviewable Alignment Brief exists for supervisor scope approval.",
      proof_surface: "manual-observation",
      source_refs: [sourceRef(id, analysisSha256, "/acceptance_criteria/0")]
    }],
    untrusted_instructions: [],
    research_source_refs: [],
    research_gaps: []
  };
}

export function buildLocalReadonlyValidation({
  operationId,
  invocationId,
  goalAnalysis,
  expectedDomains
} = {}) {
  const analysis = goalAnalysis ?? buildLocalReadonlyGoalAnalysis({ operationId, expectedDomains });
  const domains = normalizeExpectedDomains(expectedDomains);
  const ids = localReadonlyProducerIds(operationId);
  const analysisSha256 = analysis.claims?.[0]?.source_refs?.[0]?.artifact_sha256
    ?? sha256(`local-readonly-goal-analysis:${analysis.id}`);
  const analysisRef = sourceRef(analysis.id, analysisSha256, "/claims");
  return {
    schema_version: 1,
    id: ids.validationId,
    invocation_id: invocationId ?? `invocation-local-validation-${sha256(operationId).slice(0, 16)}`,
    operation_id: operationId,
    producer_analysis_id: analysis.id,
    citation_checks: (analysis.claims ?? []).map((claim, index) => ({
      id: `citation-${claim.id}`,
      proposal_id: claim.id,
      source_ref: sourceRef(analysis.id, analysisSha256, `/claims/${index}`),
      exists: true,
      supports: true,
      max_supported_class: "documented",
      finding_ids: []
    })),
    area_checks: LOCAL_READONLY_AREA_ORDER.map((area) => {
      const required = areaRequired(area, domains);
      return {
        id: `area-check-${area}`,
        area,
        applicable: required,
        covered: required,
        conflict: false,
        source_refs: [sourceRef(analysis.id, analysisSha256, `/affected_areas/${area}`)],
        finding_ids: []
      };
    }),
    question_checks: [],
    missing_items: [],
    prompt_injection_findings: [],
    verdict: "valid"
  };
}

export function buildLocalReadonlyAdapterPayload({
  phase = "analysis-plan",
  invocation = {},
  profileId,
  adapterId,
  expectedDomains
} = {}) {
  const operationId = invocation.operation_id ?? "operation-local-readonly";
  const domains = normalizeExpectedDomains(expectedDomains ?? invocation.expected_domains);
  const payload = {
    schema_version: 1,
    adapter: adapterId,
    profile_id: profileId,
    phase,
    summary: `Local readonly analysis stub completed ${phase} without external model credentials.`,
    mode: "dogfood-local-stub",
    notes: [
      "This stub advances the continue→worker path for DevHarness dogfood.",
      "Replace with the builtin Codex adapter when Codex + provider proxy are configured."
    ]
  };
  if (phase === "analysis-plan") return payload;
  const goalAnalysis = buildLocalReadonlyGoalAnalysis({
    operationId,
    expectedDomains: domains
  });
  payload.goal_analysis = goalAnalysis;
  if (phase === "analysis-validation") {
    payload.validation = buildLocalReadonlyValidation({
      operationId,
      invocationId: invocation.id,
      goalAnalysis,
      expectedDomains: domains
    });
  }
  return payload;
}
