import { createHash } from "node:crypto";

import { hashContract } from "./harness.mjs";
import { assertContract } from "./contracts.mjs";
import { createSchedule } from "../../core/src/scheduling-policy.mjs";

const REQUIRED_DOMAINS = ["repository", "runtime", "frontend", "backend", "database", "security", "strategy", "testing", "deployment", "automation"];
const CLAIM_STATUS_ORDER = ["code-confirmed", "test-confirmed", "runtime-observed", "detected", "documented", "conflict", "unverified", "not-covered"];
const COVERAGE_STATUS_ORDER = ["code-confirmed", "test-confirmed", "runtime-observed", "detected", "documented", "conflict", "unverified", "not-covered", "not-applicable"];
const UNDERSTANDING_PRIORITY = new Map(["database", "security", "strategy", "testing", "runtime", "frontend", "backend", "deployment", "automation", "repository"].map((domain, index) => [domain, index]));
const KNOWN_STATUSES = new Set(["code-confirmed", "test-confirmed", "runtime-observed", "documented"]);
const DOMAIN_KNOWLEDGE_DOMAINS = ["database", "frontend", "backend"];
const DOMAIN_KNOWLEDGE_SUBDOMAINS = {
  database: ["schema", "migrations", "constraints", "queries", "ownership"],
  frontend: ["routes", "state", "user_flows"],
  backend: ["api_contracts", "orchestration", "failure_paths"]
};
const DOMAIN_KNOWLEDGE_SUBDOMAIN_IDS = {
  database: {
    schema: ["database-surface", "database-schema"],
    migrations: ["database-migrations"],
    constraints: ["database-constraints"],
    queries: ["database-queries"],
    ownership: ["database-ownership"]
  },
  frontend: {
    routes: ["frontend-surface", "frontend-routes"],
    state: ["frontend-state"],
    user_flows: ["frontend-user_flows"]
  },
  backend: {
    api_contracts: ["backend-surface", "backend-api_contracts"],
    orchestration: ["backend-orchestration"],
    failure_paths: ["backend-failure_paths"]
  }
};

const PLAN_CHECKPOINTS = Object.freeze([
  { id: "plan-clarify", label: "Clarify", summary: "Confirm the goal, missing facts, and any hard decisions." },
  { id: "plan-design", label: "Design", summary: "Freeze the design strategy and make the acceptance points falsifiable." },
  { id: "plan-split", label: "Split work", summary: "Assign database, frontend, backend, and verification slices to isolated workstreams." },
  { id: "plan-verify", label: "Verify", summary: "Prove behavior on the real surface with tests and runtime checks." },
  { id: "plan-review", label: "Review", summary: "Review exceptions, fix root causes, and re-check the proof." },
  { id: "plan-deliver", label: "Deliver", summary: "Only then prepare the handoff or pull request." }
]);

function claim(id, domain, status, summary, evidenceRefs = []) {
  return { id, domain, status, summary, evidence_refs: evidenceRefs };
}

function capability(id, kind, reason, scope, risk = "medium", authority = "explicit") {
  return {
    id,
    capability: kind,
    operation: "prove-capability",
    target: scope[0] ?? "repository",
    scope,
    reason,
    risk,
    authority: risk === "high" ? "human-only" : authority,
    decision: "pending"
  };
}

function digestText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function staticAgentRuntimeDescriptor() {
  const descriptor = {
    schema_version: 1,
    id: "devharness-cli-local-agent",
    version: "devharness-cli-local-live-v1",
    protocol_version: 1,
    profile_id: "codex-readonly-analysis-v1",
    model_id: "local-readonly-analysis",
    executable_version: "devharness-cli",
    modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
    features: {
      structured_output: true,
      explicit_cancel: true,
      ephemeral_session: true,
      read_only_tool_policy: true,
      built_in_web_disable: true,
      trusted_usage: true
    },
    implementation_sha256: digestText("devharness-cli-live-alignment-implementation"),
    executable_sha256: digestText(process.execPath),
    profile_template_sha256: digestText("devharness-cli-live-alignment-profile-template"),
    control_plane_origins: ["https://devharness.local"],
    descriptor_sha256: "pending"
  };
  descriptor.descriptor_sha256 = digestText(JSON.stringify({ ...descriptor, descriptor_sha256: null }));
  return descriptor;
}

function staticAgentRuntimeSubject(snapshot, descriptor) {
  if (!snapshot.repository.git.head_sha) return null;
  const body = {
    schema_version: 1,
    repository_identity: snapshot.repository.identity,
    commit_sha: snapshot.repository.git.head_sha,
    descriptor_sha256: descriptor.descriptor_sha256,
    implementation_sha256: descriptor.implementation_sha256,
    executable_sha256: descriptor.executable_sha256,
    profile_template_sha256: descriptor.profile_template_sha256,
    profile_id: descriptor.profile_id,
    model_id: descriptor.model_id,
    control_plane_origins: [...descriptor.control_plane_origins],
    phases: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
    max_attempts_per_phase: 2,
    max_agent_attempts: 6,
    max_provider_requests: 120,
    provider_request_deadline_seconds: 120,
    max_active_execution_seconds: 3600,
    max_total_tokens: 600000,
    consumer_write: false,
    reversibility: "revocable-before-next-external-action"
  };
  const sha256 = hashContract(body);
  return {
    ...body,
    id: `agent-runtime-subject-${sha256.slice(0, 32)}`,
    sha256
  };
}


function staticVcsWriteCapabilityRequest(snapshot) {
  if (!snapshot?.repository?.identity || !snapshot?.repository?.git?.head_sha) return null;
  return {
    id: "vcs-write",
    capability: "vcs-write",
    operation: "bounded-consumer-change",
    target: snapshot.repository.git.head_sha,
    scope: [
      `repository:${snapshot.repository.identity}`,
      `revision:${snapshot.repository.git.head_sha}`,
      "isolated-worktree-only",
      "no-force-push",
      "no-main-checkout-mutation"
    ],
    reason: "Apply a Gate-1-approved, bounded consumer change inside an isolated Git worktree before verification.",
    risk: "high",
    authority: "human-only",
    reversibility: "Worktree commits stay outside the main checkout until an explicit promote/PR step; worktree can be removed.",
    decision: "pending"
  };
}

function staticAgentRuntimeCapabilityRequest(snapshot) {
  const descriptor = staticAgentRuntimeDescriptor();
  const subject = staticAgentRuntimeSubject(snapshot, descriptor);
  if (!subject) return null;
  return {
    id: "agent-runtime",
    capability: "agent-runtime",
    operation: "analyze-goal-read-only",
    target: subject.sha256,
    scope: [
      `repository:${snapshot.repository.identity}`,
      `revision:${snapshot.repository.git.head_sha}`,
      `descriptor:${descriptor.descriptor_sha256}`,
      `executable:${descriptor.executable_sha256}`,
      `profile-template:${descriptor.profile_template_sha256}`,
      `provider-origin:${descriptor.control_plane_origins[0]}`,
      "no-consumer-write"
    ],
    reason: "Produce and independently validate a live Alignment Brief.",
    risk: "high",
    authority: "human-only",
    reversibility: "Revocable before each external attempt; historical outputs remain labeled.",
    decision: "pending"
  };
}

function researchCapabilityRequest(task) {
  return {
    id: task.id,
    capability: "network-research",
    operation: "research",
    target: task.query,
    scope: uniqueStrings([task.topic_id, task.owner, ...(task.basis ?? []), task.query]).slice(0, 10),
    reason: task.expected_outcome ?? task.query,
    risk: "low",
    authority: "explicit",
    decision: "pending"
  };
}

function capabilityStatus(report, id) {
  return report.capabilities.find((item) => item.id === id)?.status;
}

function domainStatus(claims, domain, applicable) {
  if (!applicable) return "not-applicable";
  const statuses = claims.filter((item) => item.domain === domain).map((item) => item.status);
  const weakestFirst = ["conflict", "not-covered", "unverified", "detected", "documented", "code-confirmed", "test-confirmed", "runtime-observed"];
  return weakestFirst.find((status) => statuses.includes(status)) ?? "not-covered";
}

function countStatuses(items, order) {
  const counts = Object.fromEntries(order.map((status) => [status, 0]));
  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
  }
  return counts;
}

function formatStatusCounts(counts, order) {
  return order.map((status) => `${status}: ${counts[status] ?? 0}`).join(", ");
}

function formatPriorityDomains(coverage) {
  return [...coverage]
    .filter((item) => ["conflict", "not-covered", "unverified", "detected"].includes(item.status))
    .sort((left, right) => (UNDERSTANDING_PRIORITY.get(left.domain) ?? 99) - (UNDERSTANDING_PRIORITY.get(right.domain) ?? 99))
    .map((item) => `${item.domain}=${item.status}`);
}

function summarizeKnownness(claims) {
  const knownClaims = claims.filter((claim) => KNOWN_STATUSES.has(claim.status)).length;
  const unknownClaims = claims.filter((claim) => ["detected", "unverified", "not-covered"].includes(claim.status)).length;
  const conflictClaims = claims.filter((claim) => claim.status === "conflict").length;
  return {
    total_claims: claims.length,
    known_claims: knownClaims,
    unknown_claims: unknownClaims,
    conflict_claims: conflictClaims
  };
}

function summarizeDomainKnownness(claims) {
  return Object.fromEntries(DOMAIN_KNOWLEDGE_DOMAINS.map((domain) => {
    const domainClaims = claims.filter((claim) => claim.domain === domain);
    const subdomains = Object.fromEntries((DOMAIN_KNOWLEDGE_SUBDOMAINS[domain] ?? []).map((subdomain) => {
      const ids = DOMAIN_KNOWLEDGE_SUBDOMAIN_IDS[domain]?.[subdomain] ?? [];
      const subdomainClaims = domainClaims.filter((claim) => ids.some((id) => claim.id === id));
      return [subdomain, summarizeKnownness(subdomainClaims)];
    }));
    const totals = summarizeKnownness(domainClaims);
    return [domain, { ...totals, subdomains }];
  }));
}

function planNode(task_id, depends_on, expected_duration_seconds, resources, proof_criterion_ids, long_running = false) {
  return {
    task_id,
    depends_on,
    expected_duration_seconds,
    resources,
    workspace_id: task_id,
    proof_criterion_ids,
    long_running
  };
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))];
}

function boundedText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function formatResourceClaim(resource) {
  if (!resource) return "unknown-resource";
  const mode = resource.mode ? `:${resource.mode}` : "";
  return `${resource.kind ?? "resource"}:${resource.id ?? "unknown"}${mode}`;
}

function summarizeExecutionGraph(executionPlan, schedule) {
  const nodes = Array.isArray(executionPlan?.nodes) ? executionPlan.nodes : [];
  const waveByTaskId = new Map();
  for (const wave of schedule?.waves ?? []) {
    for (const taskId of wave.task_ids ?? []) waveByTaskId.set(taskId, wave.index ?? (waveByTaskId.size + 1));
  }
  const node_summaries = nodes.map((node) => {
    const wave_index = waveByTaskId.get(node.task_id) ?? null;
    return {
      task_id: node.task_id,
      depends_on: uniqueStrings(node.depends_on ?? []),
      resources: (node.resources ?? []).map(formatResourceClaim),
      proof_criterion_ids: uniqueStrings(node.proof_criterion_ids ?? []),
      long_running: Boolean(node.long_running),
      wave_index,
      readiness: schedule?.valid ? (wave_index === 1 ? "ready" : "waiting") : "blocked"
    };
  });
  return {
    node_count: nodes.length,
    max_parallelism: executionPlan?.max_parallelism ?? 0,
    integration_owner_task_id: executionPlan?.integration_owner_task_id ?? null,
    critical_path: schedule?.valid ? [...(schedule.critical_path ?? [])] : [],
    schedule_valid: Boolean(schedule?.valid),
    blocked_reasons: schedule?.valid ? [] : [...(schedule?.reasons ?? [])],
    next_ready_wave: schedule?.valid ? (schedule.waves?.[0] ? { index: schedule.waves[0].index, task_ids: [...schedule.waves[0].task_ids] } : null) : null,
    execution_waves: schedule?.valid ? (schedule.waves ?? []).map((wave) => ({ index: wave.index, task_ids: [...wave.task_ids] })) : [],
    nodes: node_summaries
  };
}

function stageGateDomainTags(summary) {
  const knownness = summary?.domain_knownness ?? {};
  const tags = [];
  if ((knownness.database?.total_claims ?? 0) > 0) tags.push("database");
  if ((knownness.frontend?.total_claims ?? 0) > 0) tags.push("frontend");
  if ((knownness.backend?.total_claims ?? 0) > 0) tags.push("backend");
  return tags;
}

function preflightResearchTopic(id, purpose, query, owner, priority, publicIdentifiers, expectedOutcome, basis) {
  return {
    id,
    purpose: boundedText(purpose, 1000),
    query: boundedText(query, 1000),
    owner: boundedText(owner, 200),
    priority,
    expected_outcome: boundedText(expectedOutcome, 1000),
    public_identifiers: uniqueStrings(publicIdentifiers).slice(0, 10),
    basis: uniqueStrings(basis).slice(0, 10)
  };
}

function preflightResearchTask(topic, index) {
  return {
    id: `research-task-${index + 1}`,
    topic_id: topic.id,
    query: boundedText(topic.query, 1000),
    owner: boundedText(topic.owner, 200),
    priority: topic.priority,
    approval_capability: "network-research",
    status: "pending-approval",
    expected_outcome: boundedText(topic.expected_outcome, 1000),
    basis: uniqueStrings(topic.basis ?? [])
  };
}

function preflightTeamItem(id, label, focus, taskIds, exitCriteria, basis) {
  return {
    id,
    label,
    focus,
    task_ids: uniqueStrings(taskIds).slice(0, 10),
    exit_criteria: exitCriteria,
    basis: uniqueStrings(basis).slice(0, 10)
  };
}

function preflightClarificationQuestion(blocker, index) {
  const blockerId = blocker?.id ?? `blocker-${index + 1}`;
  const summary = typeof blocker?.summary === "string" ? blocker.summary.replace(/\.$/, "") : "";
  const domainMatch = blockerId.match(/^coverage-([a-z-]+)$/i);
  const domain = domainMatch?.[1] ?? null;
  const question = domain
    ? `What do we need to confirm about the ${domain} surface before implementation can proceed?`
    : summary.length > 0
      ? `What should we decide about ${summary}?`
      : "What should we clarify before implementation can proceed?";

  return {
    id: `clarify-${index + 1}`,
    blocker_id: blockerId,
    question,
    priority: index + 1,
    basis: uniqueStrings([
      "plan-clarify",
      "goal-clarify",
      blockerId,
      domain ? `${domain}-clarification` : null
    ]).slice(0, 10)
  };
}

function summarizeStageGates(onboardingPlan, summary, planSketch) {
  const blockers = onboardingPlan.blockers ?? [];
  const capabilityRequests = onboardingPlan.capability_requests ?? [];
  const scheduleReasons = planSketch.schedule_valid ? [] : (planSketch.schedule_reasons ?? []);
  const domainTags = stageGateDomainTags(summary);
  const implementBasis = uniqueStrings([
    "understanding",
    ...domainTags,
    ...(blockers.length > 0 ? ["scope"] : []),
    ...(capabilityRequests.length > 0 ? ["capability"] : []),
    ...(scheduleReasons.length > 0 ? ["schedule"] : [])
  ]).slice(0, 10);
  const implementReasons = [
    ...(blockers.length > 0 ? [`${blockers.length} blocker(s)`] : []),
    ...(capabilityRequests.length > 0 ? [`${capabilityRequests.length} capability request(s)`] : []),
    ...(summary.unresolved_claims > 0 ? [`${summary.unresolved_claims} unresolved claim(s)`] : []),
    ...(summary.conflict_claims > 0 ? [`${summary.conflict_claims} conflict(s)`] : []),
    ...scheduleReasons
  ];
  const implementReady = implementReasons.length === 0;
  const verifyBasis = uniqueStrings([
    "testing",
    "understanding",
    ...domainTags,
    ...((planSketch.acceptance_points ?? []).length > 0 ? ["acceptance"] : []),
    ...(scheduleReasons.length > 0 ? ["schedule"] : [])
  ]).slice(0, 10);
  const verifyReasons = [
    ...(!implementReady ? ["implementation gate blocked"] : []),
    ...(!planSketch.schedule_valid ? scheduleReasons.map((reason) => `schedule ${reason}`) : []),
    ...((planSketch.execution_waves ?? []).length === 0 ? ["execution waves not yet derivable"] : []),
    ...((planSketch.acceptance_points ?? []).length === 0 ? ["acceptance checkpoints missing"] : [])
  ];
  const verifyReady = verifyReasons.length === 0;
  const deliverBasis = uniqueStrings([
    "delivery",
    "testing",
    "understanding",
    ...domainTags,
    ...(verifyReady ? [] : ["verification"]),
    ...(blockers.length > 0 ? ["scope"] : []),
    ...(capabilityRequests.length > 0 ? ["capability"] : []),
    ...((planSketch.acceptance_points ?? []).length > 0 ? ["acceptance"] : [])
  ]).slice(0, 10);
  const deliverReasons = [
    ...(!verifyReady ? ["verification gate blocked"] : []),
    ...(summary.unresolved_claims > 0 ? [`${summary.unresolved_claims} unresolved claim(s)`] : []),
    ...(summary.conflict_claims > 0 ? [`${summary.conflict_claims} conflict(s)`] : []),
    ...(blockers.length > 0 ? [`${blockers.length} blocker(s)`] : []),
    ...(capabilityRequests.length > 0 ? [`${capabilityRequests.length} capability request(s)`] : [])
  ];
  return {
    implement: { status: implementReady ? "ready" : "blocked", reasons: implementReasons.slice(0, 5), basis: implementBasis },
    verify: { status: verifyReady ? "ready" : "blocked", reasons: verifyReasons.slice(0, 5), basis: verifyBasis },
    deliver: { status: deliverReasons.length === 0 ? "ready" : "blocked", reasons: deliverReasons.slice(0, 5), basis: deliverBasis }
  };
}

export function summarizeStageGateMetrics(stageGates) {
  if (!stageGates) return null;
  const gates = [stageGates.implement, stageGates.verify, stageGates.deliver].filter(Boolean);
  const ready = gates.filter((gate) => gate.status === "ready").length;
  const blocked = gates.length - ready;
  const totalReasons = gates.reduce((sum, gate) => sum + (gate.reasons?.length ?? 0), 0);
  return {
    total: gates.length,
    ready,
    blocked,
    total_reasons: totalReasons,
    reasons_by_gate: {
      implement: stageGates.implement?.reasons?.length ?? 0,
      verify: stageGates.verify?.reasons?.length ?? 0,
      deliver: stageGates.deliver?.reasons?.length ?? 0
    }
  };
}

function buildPreflightPlan(snapshot, summary, capabilityRequests, blockers = [], executionPlan = null) {
  const frameworks = uniqueStrings(snapshot.detected.frameworks);
  const services = uniqueStrings(snapshot.detected.services);
  const testTools = uniqueStrings(snapshot.detected.test_tools);
  const deploymentFiles = uniqueStrings(snapshot.detected.deployment_files);
  const ciFiles = uniqueStrings(snapshot.detected.ci_files);
  const databaseSignals = uniqueStrings([
    ...services.filter((service) => /postgres|mysql|sqlite|mariadb|mongodb|redis|kafka/i.test(service)),
    ...snapshot.environment.declared_keys.filter((key) => /(database|db)_?(url|host|name)?/i.test(key))
  ]);
  const capabilityIds = uniqueStrings(capabilityRequests.map((request) => request.id));
  const capabilityKinds = new Set(capabilityRequests.map((request) => request.capability));
  const topics = [];

  if (databaseSignals.length > 0) {
    topics.push(preflightResearchTopic(
      "research-database-best-practices",
      `Review ${databaseSignals.slice(0, 3).join(" / ")} guidance for schema, migrations, constraints, transactions, and query safety before any data change.`,
      `Official best practices for ${databaseSignals[0]} schema design, migrations, constraints, transactions, and safe query patterns`,
      "database",
      1,
      databaseSignals,
      "Ensure the data model, ownership, and migration path are known before implementation hardens assumptions.",
      ["database", "database-runtime", ...databaseSignals.map((signal) => `database:${signal}`)]
    ));
  }

  if (frameworks.length > 0) {
    topics.push(preflightResearchTopic(
      "research-framework-best-practices",
      `Review official best practices for ${frameworks.slice(0, 3).join(" / ")} so routing, state, and data flow decisions stay consistent.`,
      `Official best practices for ${frameworks.slice(0, 3).join(" and ")} routing, state, data flow, and server/client boundaries`,
      "frontend",
      databaseSignals.length > 0 ? 3 : 2,
      frameworks,
      "Keep framework-specific implementation choices consistent with public guidance before team members start coding.",
      ["frameworks", ...frameworks.map((framework) => `framework:${framework}`), "frontend", "backend"]
    ));
  }

  if (capabilityKinds.has("browser-runtime") || testTools.includes("Playwright") || snapshot.detected.platforms.includes("web")) {
    topics.push(preflightResearchTopic(
      "research-browser-verification-best-practices",
      "Review browser verification best practices so the team proves real user flows, not only API reachability or command exit codes.",
      `Official browser verification best practices for ${uniqueStrings([...testTools, "browser automation"]).join(" and ") || "browser automation"} and real user flows`,
      "verification",
      2,
      uniqueStrings([...testTools, "browser-runtime", "Playwright", "browser automation"]),
      "Prove real browser behavior, not just command success or API reachability.",
      ["browser-runtime", "testing", "runtime", ...capabilityIds]
    ));
  }

  if (capabilityKinds.has("simulator-runtime") || snapshot.detected.platforms.some((platform) => ["mobile", "desktop"].includes(platform))) {
    topics.push(preflightResearchTopic(
      "research-simulator-best-practices",
      "Review simulator or device best practices so the team can exercise the actual surface before release decisions are made.",
      `Official simulator or device best practices for ${uniqueStrings(snapshot.detected.platforms).join(" and ") || "interactive surfaces"}`,
      "verification",
      2,
      ["simulator runtime", ...uniqueStrings(snapshot.detected.platforms)],
      "Exercise the actual device or simulator surface before any release decision.",
      ["simulator-runtime", "runtime", ...capabilityIds]
    ));
  }

  if (snapshot.detected.ci_files.length > 0 || snapshot.detected.deployment_files.length > 0 || capabilityKinds.has("container-runtime")) {
    topics.push(preflightResearchTopic(
      "research-delivery-best-practices",
      "Review CI and deployment best practices so release automation, rollback behavior, and environment assumptions stay explicit.",
      `Official CI and deployment best practices for ${uniqueStrings([...ciFiles, ...deploymentFiles]).join(" and ") || "delivery automation"}`,
      "integration",
      4,
      uniqueStrings([...ciFiles, ...deploymentFiles, "CI", "deployment"]),
      "Keep release automation, rollback behavior, and environment assumptions explicit.",
      ["deployment", "automation", "container-runtime", ...capabilityIds]
    ));
  }

  if (snapshot.detected.platforms.length > 0 || snapshot.detected.services.length > 0) {
    topics.push(preflightResearchTopic(
      "research-security-best-practices",
      "Review current security best practices for trust boundaries, credentials, and state transitions before implementation hardens any assumption.",
      `Official security best practices for trust boundaries, credentials, and state transitions in ${uniqueStrings([...snapshot.detected.platforms, ...services]).join(" and ") || "the repository"}`,
      "security",
      1,
      uniqueStrings([...snapshot.detected.platforms, ...services, "security"]),
      "Keep trust boundaries, secrets, and state transitions explicit before implementation.",
      ["security", "credential-reference", ...capabilityIds]
    ));
  }

  const nodeIds = new Set((executionPlan?.nodes ?? []).map((node) => node.task_id ?? node.id).filter(Boolean));
  const nodeList = (ids) => {
    const matched = ids.filter((id) => nodeIds.has(id));
    return matched.length > 0 ? matched : ids.slice(0, 10);
  };

  const teamDecomposition = [
    preflightTeamItem(
      "team-discovery",
      "Discovery",
      "Resolve repository and goal ambiguities before implementation starts.",
      nodeList(["goal-clarify", "goal-design"]),
      "All material questions are either answered or explicitly approved as assumptions.",
      ["plan-clarify", "plan-design", "repository", "strategy"]
    )
  ];

  if (summary.domain_knownness.database.total_claims > 0) {
    teamDecomposition.push(preflightTeamItem(
      "team-database",
      "Database",
      "Own schema, migrations, constraints, queries, and data ownership.",
      nodeList(["goal-database"]),
      "The data model is validated against a disposable database and the ownership story is explicit.",
      ["database", "database-runtime", "plan-split"]
    ));
  }

  if (summary.domain_knownness.frontend.total_claims > 0) {
    teamDecomposition.push(preflightTeamItem(
      "team-frontend",
      "Frontend",
      "Own routes, state, and user flows on the real browser surface.",
      nodeList(["goal-frontend"]),
      "The user journey is exercised in a browser or simulator with evidence, not just static reasoning.",
      ["frontend", "browser-runtime", "plan-split"]
    ));
  }

  if (summary.domain_knownness.backend.total_claims > 0) {
    teamDecomposition.push(preflightTeamItem(
      "team-backend",
      "Backend",
      "Own API contracts, orchestration, and failure paths.",
      nodeList(["goal-backend"]),
      "The backend path is traced end to end, including meaningful failure handling.",
      ["backend", "service-runtime", "plan-split"]
    ));
  }

  if (capabilityKinds.has("browser-runtime") || capabilityKinds.has("simulator-runtime") || capabilityKinds.has("service-runtime") || capabilityKinds.has("container-runtime") || capabilityKinds.has("database-runtime")) {
    teamDecomposition.push(preflightTeamItem(
      "team-verification",
      "Verification",
      "Own unit, functional, and system proof on the real surface.",
      nodeList(["goal-verify"]),
      "Unit tests, functional checks, and system-level evidence all exist for the changed slice.",
      ["verification", "browser-runtime", "simulator-runtime", "database-runtime", "service-runtime"]
    ));
  }

  teamDecomposition.push(preflightTeamItem(
    "team-integration",
    "Integration",
    "Own the merge-ready reconciliation step and resolve cross-domain conflicts.",
    nodeList(["goal-review", "goal-integrate"]),
    "Cross-domain changes are reconciled into a reviewable handoff with no unresolved contradictions.",
    ["plan-review", "plan-deliver", "integration"]
  ));

  const clarificationQuestions = (blockers ?? [])
    .slice(0, 3)
    .map((blocker, index) => preflightClarificationQuestion(blocker, index));

  return {
    clarification_questions: clarificationQuestions,
    research_topics: topics.slice(0, 5).sort((left, right) => (left.priority ?? 99) - (right.priority ?? 99) || left.id.localeCompare(right.id)),
    research_tasks: topics.slice(0, 5)
      .sort((left, right) => (left.priority ?? 99) - (right.priority ?? 99) || left.id.localeCompare(right.id))
      .map((topic, index) => preflightResearchTask(topic, index)),
    team_decomposition: teamDecomposition
  };
}

export function buildGoalExecutionPlan(onboardingPlan) {
  const summary = onboardingPlan.summary ?? summarizeUnderstanding(onboardingPlan.claims, onboardingPlan.coverage ?? []);
  const executionPlanSeed = {
    schema_version: 1,
    id: `execution-${hashContract({
      repository_identity: onboardingPlan.repository_identity,
      commit_sha: onboardingPlan.commit_sha,
      claims: onboardingPlan.claims.map((claim) => claim.id),
      blockers: onboardingPlan.blockers.map((blocker) => blocker.id)
    }).slice(0, 32)}`,
    run_id: `onboard-${hashContract({
      repository_identity: onboardingPlan.repository_identity,
      commit_sha: onboardingPlan.commit_sha,
      claims: onboardingPlan.claims.map((claim) => claim.id)
    }).slice(0, 32)}`,
    head_sha: onboardingPlan.commit_sha ?? "0".repeat(40),
    progress_interval_seconds: 60,
    max_parallelism: Math.max(2, Math.min(4, 1 + ["database", "frontend", "backend"].filter((domain) => (summary.domain_knownness?.[domain]?.total_claims ?? 0) > 0).length))
  };
  const nodes = [
    planNode(
      "goal-clarify",
      [],
      15,
      [{ kind: "workspace", id: "goal-clarify", mode: "exclusive" }],
      ["plan-clarify"]
    ),
    planNode(
      "goal-design",
      ["goal-clarify"],
      20,
      [{ kind: "workspace", id: "goal-design", mode: "exclusive" }],
      ["plan-design"]
    )
  ];

  const domainTasks = [];
  if (summary.domain_knownness.database.total_claims > 0) {
    domainTasks.push("goal-database");
    nodes.push(planNode(
      "goal-database",
      ["goal-design"],
      25,
      [{ kind: "path", id: "database", mode: "exclusive" }, { kind: "workspace", id: "goal-database", mode: "exclusive" }],
      ["plan-split"]
    ));
  }
  if (summary.domain_knownness.frontend.total_claims > 0) {
    domainTasks.push("goal-frontend");
    nodes.push(planNode(
      "goal-frontend",
      ["goal-design"],
      25,
      [{ kind: "path", id: "frontend", mode: "exclusive" }, { kind: "workspace", id: "goal-frontend", mode: "exclusive" }],
      ["plan-split"]
    ));
  }
  if (summary.domain_knownness.backend.total_claims > 0) {
    domainTasks.push("goal-backend");
    nodes.push(planNode(
      "goal-backend",
      ["goal-design"],
      25,
      [{ kind: "path", id: "backend", mode: "exclusive" }, { kind: "workspace", id: "goal-backend", mode: "exclusive" }],
      ["plan-split"]
    ));
  }

  const verificationDependsOn = domainTasks.length > 0 ? [...domainTasks] : ["goal-design"];
  const verificationResources = [{ kind: "workspace", id: "goal-verify", mode: "exclusive" }];
  if (onboardingPlan.capability_requests.some((request) => request.capability === "browser-runtime")) verificationResources.push({ kind: "path", id: "verification/browser", mode: "exclusive" });
  if (onboardingPlan.capability_requests.some((request) => request.capability === "database-runtime")) verificationResources.push({ kind: "database", id: "verification-database", mode: "exclusive" });
  nodes.push(planNode(
    "goal-verify",
    verificationDependsOn,
    30,
    verificationResources,
    ["plan-verify"]
  ));

  nodes.push(planNode(
    "goal-review",
    ["goal-verify"],
    15,
    [{ kind: "workspace", id: "goal-review", mode: "exclusive" }],
    ["plan-review"]
  ));

  nodes.push(planNode(
    "goal-integrate",
    ["goal-review"],
    20,
    [
      { kind: "workspace", id: "goal-integrate", mode: "exclusive" },
      { kind: "external", id: "git:integration-branch", mode: "exclusive" }
    ],
    ["plan-deliver"]
  ));

  return {
    ...executionPlanSeed,
    integration_owner_task_id: "goal-integrate",
    nodes
  };
}

export function summarizeGoalPlan(onboardingPlan) {
  const summary = onboardingPlan.summary ?? summarizeUnderstanding(onboardingPlan.claims, onboardingPlan.coverage ?? []);
  const capabilityRequests = onboardingPlan.capability_requests ?? [];
  const requestedCapabilities = new Set(capabilityRequests.map((request) => request.capability));
  const execution_plan = onboardingPlan.execution_plan ?? buildGoalExecutionPlan(onboardingPlan);
  const schedule = createSchedule(execution_plan);
  const preflight = onboardingPlan.preflight ?? buildPreflightPlan(
    {
      detected: { frameworks: [], services: [], test_tools: [], platforms: [], ci_files: [], deployment_files: [] },
      environment: { declared_keys: [], locally_set_keys: [] }
    },
    summary,
    capabilityRequests,
    onboardingPlan.blockers ?? [],
    execution_plan
  );
  const crew = preflight.team_decomposition.map((team) => ({
    id: team.id.replace(/^team-/, ""),
    label: team.label,
    focus: team.focus,
    source_refs: ["artifact-onboarding-plan"]
  }));
  const acceptance_points = preflight.team_decomposition.map((team) => team.exit_criteria);
  const stage_gates = summarizeStageGates(onboardingPlan, summary, {
    schedule_valid: schedule.valid,
    schedule_reasons: schedule.reasons,
    execution_waves: schedule.waves,
    acceptance_points
  });
  const execution_graph = summarizeExecutionGraph(execution_plan, schedule);

  return {
    crew,
    preflight,
    checkpoints: PLAN_CHECKPOINTS,
    acceptance_points,
    stage_gates,
    stage_gate_metrics: summarizeStageGateMetrics(stage_gates),
    execution_graph,
    execution_plan,
    execution_waves: schedule.valid
      ? schedule.waves.map((wave, index) => ({ index: index + 1, task_ids: wave.task_ids }))
      : [],
    critical_path: schedule.valid ? schedule.critical_path : [],
    schedule_valid: schedule.valid,
    schedule_reasons: schedule.valid ? [] : schedule.reasons
  };
}

function summarizeUnderstanding(claims, coverage) {
  const claim_status_counts = countStatuses(claims, CLAIM_STATUS_ORDER);
  const coverage_status_counts = countStatuses(coverage, COVERAGE_STATUS_ORDER);
  return {
    total_claims: claims.length,
    proved_claims: claims.filter((item) => ["code-confirmed", "test-confirmed", "runtime-observed"].includes(item.status)).length,
    unresolved_claims: claims.filter((item) => ["conflict", "unverified", "not-covered"].includes(item.status)).length,
    conflict_claims: claims.filter((item) => item.status === "conflict").length,
    claim_status_counts,
    coverage_status_counts,
    domain_knownness: summarizeDomainKnownness(claims),
    priority_domains: formatPriorityDomains(coverage)
  };
}

export async function createOnboardingPlan(snapshot, { report, config = null, configError = null, configSource = "tracked", generatedAt = new Date().toISOString() } = {}) {
  const claims = [];
  const repositoryEvidence = [
    ...snapshot.inventory.manifests,
    ...snapshot.inventory.lockfiles,
    ...(snapshot.repository.git.head_sha ? [snapshot.repository.git.head_sha] : [])
  ];
  claims.push(claim("repository-inventory", "repository", snapshot.repository.git.dirty ? "unverified" : "code-confirmed", snapshot.repository.git.dirty ? "The working-tree inventory was inspected, but uncommitted content is not bound to the recorded HEAD revision." : "Repository identity, revision and committed inventory were inspected read-only.", repositoryEvidence));

  if (config) claims.push(claim(
    "project-declaration",
    "repository",
    "code-confirmed",
    configSource === "external" ? "A valid explicit external project declaration was parsed." : "A valid tracked project declaration was parsed.",
    [configSource === "external" ? "external-project-config" : "devharness.yaml"]
  ));
  else claims.push(claim("project-declaration", "repository", configError && !/No devharness\.yaml/.test(configError) && configError !== "missing" ? "conflict" : "unverified", configError ?? "No accepted project declaration is available.", []));

  if (snapshot.detected.platforms.includes("web")) {
    claims.push(claim("frontend-surface", "frontend", "detected", "A web frontend was detected; it has not been opened or exercised.", snapshot.detected.frameworks));
    claims.push(claim("frontend-routes", "frontend", "detected", "Frontend route structure is present, but real navigation has not been exercised.", snapshot.detected.frameworks));
    claims.push(claim("frontend-state", "frontend", "unverified", "Client state, hydration and mutation flows are not yet traced.", snapshot.detected.frameworks));
    claims.push(claim("frontend-user_flows", "frontend", "not-covered", "Real user flows have not been proven in a browser.", snapshot.detected.frameworks));
  }
  if (snapshot.detected.platforms.includes("api") || snapshot.detected.frameworks.includes("Next.js")) {
    claims.push(claim("backend-surface", "backend", "detected", "An API/backend surface was detected; request and failure flows are not yet traced.", snapshot.detected.frameworks));
    claims.push(claim("backend-api_contracts", "backend", "detected", "Backend API contracts are discoverable, but not yet verified against behavior.", snapshot.detected.frameworks));
    claims.push(claim("backend-orchestration", "backend", "unverified", "Backend orchestration and service coordination are not yet traced end-to-end.", snapshot.detected.frameworks));
    claims.push(claim("backend-failure_paths", "backend", "not-covered", "Failure and retry paths have not been exercised.", snapshot.detected.frameworks));
  }

  const databaseSignals = [
    ...snapshot.detected.services.filter((service) => /postgres|mysql|mongo|redis|kafka/i.test(service)),
    ...snapshot.environment.declared_keys.filter((key) => /(database|db)_?(url|host|name)?/i.test(key))
  ];
  if (databaseSignals.length > 0) {
    claims.push(claim("database-surface", "database", "detected", "Database signals were found; schema, migrations, constraints, transactions and live behavior are unverified.", databaseSignals));
    claims.push(claim("database-schema", "database", "detected", "A database schema is implied by the current signals, but its shape is not yet validated.", databaseSignals));
    claims.push(claim("database-migrations", "database", "detected", "Migration history is present or implied, but it has not been exercised.", databaseSignals));
    claims.push(claim("database-constraints", "database", "unverified", "Constraints and transactional guarantees are not yet traced from source to store.", databaseSignals));
    claims.push(claim("database-queries", "database", "unverified", "Query behavior and access patterns are not yet verified against a live database.", databaseSignals));
    claims.push(claim("database-ownership", "database", "not-covered", "Data ownership and lifecycle responsibilities are not yet modeled.", databaseSignals));
  }

  const testStatus = capabilityStatus(report, "automated-tests");
  const behaviorStatus = capabilityStatus(report, "behavior-verification");
  const launchStatus = capabilityStatus(report, "service-launch");
  claims.push(claim("test-surface", "testing", testStatus === "pass" ? "test-confirmed" : snapshot.detected.test_tools.length > 0 ? "detected" : "not-covered", testStatus === "pass" ? "Configured tests have a current isolated receipt." : "Test tooling may exist but has not produced current proof.", testStatus === "pass" ? ["readiness:automated-tests"] : snapshot.detected.test_tools));
  claims.push(claim("runtime-surface", "runtime", "unverified", launchStatus === "pass" && behaviorStatus === "pass" ? "Configured lifecycle and verification commands passed, but current receipts do not prove a real browser/simulator/CLI surface or full system behavior." : "The application, browser/simulator and user-visible behavior were not executed by onboarding.", launchStatus === "pass" ? ["readiness:service-launch", "readiness:behavior-verification"] : []));
  claims.push(claim("security-model", "security", "not-covered", "Roles, permissions, trust boundaries, state transitions, abuse cases and data lifecycle are not yet modeled.", []));
  claims.push(claim("design-strategy", "strategy", "not-covered", "No developer-approved design and architecture strategy baseline has been established.", []));
  claims.push(claim("deployment-surface", "deployment", snapshot.detected.deployment_files.length > 0 || snapshot.detected.ci_files.length > 0 ? "detected" : "not-covered", snapshot.detected.deployment_files.length > 0 || snapshot.detected.ci_files.length > 0 ? "Deployment or delivery automation files exist but were not executed." : "No deployment surface was analyzed.", [...snapshot.detected.deployment_files, ...snapshot.detected.ci_files]));
  claims.push(claim("automation-surface", "automation", "not-covered", "Bootstrap, migration, rollback and deployment automation have not been exercised in a disposable environment.", []));

  const interactive = snapshot.detected.platforms.some((platform) => ["web", "mobile", "desktop"].includes(platform));
  const server = snapshot.detected.platforms.includes("api") || snapshot.detected.frameworks.includes("Next.js");
  const applicableDomains = new Set(["repository", "runtime", "strategy", "testing", "automation"]);
  if (interactive) applicableDomains.add("frontend");
  if (server) applicableDomains.add("backend");
  if (databaseSignals.length > 0) applicableDomains.add("database");
  if (interactive || server || databaseSignals.length > 0) applicableDomains.add("security");
  if (snapshot.detected.deployment_files.length > 0 || snapshot.detected.ci_files.length > 0 || snapshot.repository.git.remote_hosts.length > 0) applicableDomains.add("deployment");
  const coverage = REQUIRED_DOMAINS.map((domain) => ({
    domain,
    status: domainStatus(claims, domain, applicableDomains.has(domain)),
    claim_ids: claims.filter((item) => item.domain === domain).map((item) => item.id)
  }));
  const summary = summarizeUnderstanding(claims, coverage);

  const capabilityRequests = [];
  const agentRuntimeCapability = staticAgentRuntimeCapabilityRequest(snapshot);
  if (agentRuntimeCapability) capabilityRequests.push(agentRuntimeCapability);
  const vcsWriteCapability = staticVcsWriteCapabilityRequest(snapshot);
  if (vcsWriteCapability) capabilityRequests.push(vcsWriteCapability);
  if (snapshot.inventory.manifests.length > 0) capabilityRequests.push(capability("dependency-install", "dependency-install", "Reproduce dependencies from committed lockfiles in isolation.", snapshot.inventory.manifests, "medium"));
  if (snapshot.detected.platforms.includes("web")) capabilityRequests.push(capability("browser-runtime", "browser-runtime", "Open and exercise the real user interface with screenshots, console and network evidence.", ["local-browser"], "medium"));
  if (snapshot.detected.platforms.includes("mobile")) capabilityRequests.push(capability("simulator-runtime", "simulator-runtime", "Build and exercise the application in a simulator or approved device.", ["local-simulator"], "medium"));
  if (snapshot.detected.platforms.some((platform) => ["web", "api", "desktop", "mobile"].includes(platform))) capabilityRequests.push(capability("service-runtime", "process-execution", "Launch runtime-owned local services with readiness and teardown.", ["isolated-worktree"], "medium"));
  if (snapshot.detected.services.includes("Docker Compose") || snapshot.detected.deployment_files.some((file) => /(^|\/)Dockerfile|compose/i.test(file))) capabilityRequests.push(capability("container-runtime", "container-runtime", "Build and run only declared local/test containers with runtime-owned teardown.", ["local-test-containers"], "high"));
  if (databaseSignals.length > 0) capabilityRequests.push(capability("database-runtime", "database-runtime", "Run migrations, constraints, concurrency and query-plan checks against a disposable database.", ["disposable-database"], "high"));
  const missingKeys = snapshot.environment.declared_keys.filter((key) => !snapshot.environment.locally_set_keys.includes(key));
  if (missingKeys.length > 0) capabilityRequests.push(capability("credential-references", "credential-reference", `Resolve the minimal scoped secret references for approved local recipes after configuration (${missingKeys.length} declared keys are currently unset; production keys are excluded by default).`, ["approved-local-recipes"], "high"));

  const coveragePriority = new Map(["database", "security", "strategy", "testing", "runtime", "frontend", "backend", "deployment", "automation", "repository"].map((domain, index) => [domain, index]));
  const coverageBlockers = coverage
    .filter((item) => ["not-covered", "unverified", "detected", "conflict"].includes(item.status))
    .sort((left, right) => (coveragePriority.get(left.domain) ?? 99) - (coveragePriority.get(right.domain) ?? 99))
    .map((item) => ({ id: `coverage-${item.domain}`, summary: `${item.domain} understanding is ${item.status}.` }));
  const blockers = [
    ...coverageBlockers,
    ...report.biggest_blockers.map((id) => ({ id: `readiness-${id}`, summary: report.capabilities.find((item) => item.id === id)?.summary ?? id }))
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
  const executionPlan = snapshot.repository.git.head_sha
    ? buildGoalExecutionPlan({
      repository_identity: snapshot.repository.identity,
      commit_sha: snapshot.repository.git.head_sha,
      summary,
      claims,
      coverage,
      capability_requests: capabilityRequests,
      blockers
    })
    : null;
  const preflight = buildPreflightPlan(snapshot, summary, capabilityRequests, blockers, executionPlan);
  const execution_graph = executionPlan ? summarizeExecutionGraph(executionPlan, createSchedule(executionPlan)) : null;
  capabilityRequests.push(...preflight.research_tasks.map((task) => researchCapabilityRequest(task)));

  const body = {
    schema_version: 1,
    repository_identity: snapshot.repository.identity,
    ...(snapshot.repository.git.head_sha ? { commit_sha: snapshot.repository.git.head_sha } : {}),
    workspace: { dirty: snapshot.repository.git.dirty, changed_file_count: snapshot.repository.git.changed_file_count },
    mode: "read-only-plan",
    verdict: snapshot.repository.git.head_sha ? "needs-evidence" : "blocked",
    summary,
    claims,
    coverage,
    capability_requests: capabilityRequests,
    ...(executionPlan ? { execution_plan: executionPlan } : {}),
    ...(execution_graph ? { execution_graph } : {}),
    preflight,
    blockers,
    limitations: [
      "No project command, dependency installer, service, browser, simulator or database was executed.",
      "Detected configuration and tools are not treated as proof of working behavior.",
      "System flows, security invariants and design strategy still require evidence-backed modeling and developer approval."
    ],
    next_action: {
      id: config ? "approve-capability-plan" : "accept-project-declaration",
      label: config ? "Review and approve the bounded capability plan" : "Run `devharness init --repo PATH`, review the proposal, then accept it with --write",
      recommended: true
    }
  };
  const plan = { ...body, id: `onboard-${hashContract(body).slice(0, 32)}`, generated_at: generatedAt };
  await assertContract("onboarding-plan", plan);
  return plan;
}

export function formatRepositoryUnderstandingBrief(plan) {
  const summary = plan.summary ?? summarizeUnderstanding(plan.claims, plan.coverage ?? []);
  const conflictClaims = plan.claims.filter((item) => item.status === "conflict");
  const domainKnownness = summary.domain_knownness ?? summarizeDomainKnownness(plan.claims);
  const planSketch = summarizeGoalPlan(plan);
  const preflight = planSketch.preflight ?? { clarification_questions: [], research_topics: [], research_tasks: [], team_decomposition: [] };
  const clarificationQuestions = preflight.clarification_questions ?? [];
  const researchTopics = preflight.research_topics ?? [];
  const researchTasks = preflight.research_tasks ?? [];
  const teamDecomposition = preflight.team_decomposition ?? [];
  const stageGates = planSketch.stage_gates ?? summarizeStageGates(plan, summary, planSketch);
  const stageGateMetrics = planSketch.stage_gate_metrics ?? summarizeStageGateMetrics(stageGates);
  const executionGraph = planSketch.execution_graph ?? { node_count: 0, max_parallelism: 0, integration_owner_task_id: null, critical_path: [], schedule_valid: false, blocked_reasons: [], next_ready_wave: null, execution_waves: [], nodes: [] };
  const capabilityCounts = new Map();
  for (const request of plan.capability_requests ?? []) capabilityCounts.set(request.capability, (capabilityCounts.get(request.capability) ?? 0) + 1);
  const formatStageGate = (label, gate) => `${label} ${gate.status}${gate.reasons.length > 0 ? ` (${gate.reasons.join("; ")})` : ""}`;
  const formatStageGateMetrics = (metrics) => metrics ? `${metrics.ready}/${metrics.total} ready · ${metrics.blocked} blocked · ${metrics.total_reasons} reason(s)` : "not recorded";
  const formatExecutionGraph = (graph) => {
    if (!graph) return "not recorded";
    const owner = graph.integration_owner_task_id ?? "unknown";
    const criticalPath = graph.critical_path?.join(" → ") || "not yet derivable";
    const nextWave = graph.schedule_valid
      ? (graph.next_ready_wave?.task_ids?.length > 0 ? `next ready wave ${graph.next_ready_wave.index}: ${graph.next_ready_wave.task_ids.join(", ")}` : "next ready wave: none")
      : `blocked: ${graph.blocked_reasons.map((reason) => reason.summary).join("; ") || "schedule invalid"}`;
    return `${graph.node_count} nodes · max parallelism ${graph.max_parallelism} · integration owner ${owner} · critical path ${criticalPath} · ${nextWave}`;
  };
  const knowledgeLine = DOMAIN_KNOWLEDGE_DOMAINS.map((domain) => {
    const item = domainKnownness[domain] ?? { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} };
    return `${domain} known ${item.known_claims}/${item.total_claims} · unknown ${item.unknown_claims} · conflict ${item.conflict_claims}`;
  }).join("; ");
  const lines = [
    "Repository Understanding Brief",
    `Verdict: ${plan.verdict}`,
    `Repository: ${plan.repository_identity}`,
    `Revision: ${plan.commit_sha ?? "no committed revision"}`,
    `Understanding summary: proved ${summary.proved_claims}/${summary.total_claims} · unresolved ${summary.unresolved_claims} · conflicts ${summary.conflict_claims}`,
    `Claim states: ${formatStatusCounts(summary.claim_status_counts, CLAIM_STATUS_ORDER)}`,
    `Coverage states: ${formatStatusCounts(summary.coverage_status_counts, COVERAGE_STATUS_ORDER)}`,
    `Domain knownness: ${knowledgeLine}`,
    `Execution graph: ${formatExecutionGraph(executionGraph)}`,
    `Plan sketch: ${planSketch.checkpoints.map((step) => step.label).join(" → ")}`,
    `Preflight path: clarify ${clarificationQuestions.length > 0 ? `${clarificationQuestions.length} question(s)` : "none"} → research ${researchTopics.length} topic(s) → split ${teamDecomposition.length} crew group(s)`,
    `Clarification queue: ${clarificationQuestions.length > 0 ? clarificationQuestions.map((question) => question.question).join(" · ") : "none"}`,
    `Preflight research: ${researchTasks.length > 0 ? researchTasks.map((task) => `${task.owner ?? "team"}:${task.priority ?? "?"} ${task.query ?? task.topic_id}`).join(" · ") : "none"}`,
    `Team decomposition: ${teamDecomposition.length > 0 ? teamDecomposition.map((team) => `${team.label} → ${team.task_ids.join(", ") || "no tasks"}`).join(" | ") : "none"}`,
    `Likely crew: ${planSketch.crew.map((item) => item.label).join(" · ")}`,
    `Acceptance checkpoints: ${planSketch.acceptance_points.join(" · ")}`,
    `Stage gates: ${formatStageGateMetrics(stageGateMetrics)} · ${formatStageGate("implement", stageGates.implement)} · ${formatStageGate("verify", stageGates.verify)} · ${formatStageGate("deliver", stageGates.deliver)}`,
    `Execution waves: ${planSketch.execution_waves.length > 0 ? planSketch.execution_waves.map((wave) => `wave ${wave.index}: ${wave.task_ids.join(", ")}`).join(" | ") : "not yet derivable"}`,
    `Critical path: ${planSketch.critical_path.join(" → ") || "not yet derivable"}`,
    ...DOMAIN_KNOWLEDGE_DOMAINS.map((domain) => {
      const item = domainKnownness[domain] ?? { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} };
      const subdomainText = (DOMAIN_KNOWLEDGE_SUBDOMAINS[domain] ?? []).map((subdomain) => {
        const sub = item.subdomains?.[subdomain] ?? { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 };
        return `${subdomain} ${sub.known_claims}/${sub.total_claims}`;
      }).join(", ");
      return `${domain} detail: ${subdomainText || "none"}`;
    }),
    "",
    ...(conflictClaims.length > 0 ? ["Conflicts:"] : []),
    ...conflictClaims.slice(0, 3).map((conflict) => `- ${conflict.domain}: ${conflict.summary}`),
    "Highest-priority gaps:"
  ];
  if (summary.priority_domains.length > 0) lines.push(`- ${summary.priority_domains.join(", ")}`);
  for (const blocker of plan.blockers.slice(0, 5)) lines.push(`- ${blocker.summary}`);
  lines.push("", `Authority requests: ${capabilityCounts.size > 0 ? [...capabilityCounts.entries()].map(([capability, count]) => count > 1 ? `${capability} × ${count}` : capability).join(", ") : "none"}`);
  lines.push(`Next: ${plan.next_action.label}`);
  return lines.join("\n");
}
