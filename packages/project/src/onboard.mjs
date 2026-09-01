import { hashContract } from "./harness.mjs";
import { assertContract } from "./contracts.mjs";

const REQUIRED_DOMAINS = ["repository", "runtime", "frontend", "backend", "database", "security", "strategy", "testing", "deployment", "automation"];

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

function capabilityStatus(report, id) {
  return report.capabilities.find((item) => item.id === id)?.status;
}

function domainStatus(claims, domain, applicable) {
  if (!applicable) return "not-applicable";
  const statuses = claims.filter((item) => item.domain === domain).map((item) => item.status);
  const weakestFirst = ["conflict", "not-covered", "unverified", "detected", "documented", "code-confirmed", "test-confirmed", "runtime-observed"];
  return weakestFirst.find((status) => statuses.includes(status)) ?? "not-covered";
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
  }
  if (snapshot.detected.platforms.includes("api")) {
    claims.push(claim("backend-surface", "backend", "detected", "An API/backend surface was detected; request and failure flows are not yet traced.", snapshot.detected.frameworks));
  }

  const databaseSignals = [
    ...snapshot.detected.services.filter((service) => /postgres|mysql|mongo|redis|kafka/i.test(service)),
    ...snapshot.environment.declared_keys.filter((key) => /(database|db)_?(url|host|name)?/i.test(key))
  ];
  if (databaseSignals.length > 0) {
    claims.push(claim("database-surface", "database", "detected", "Database signals were found; schema, migrations, constraints, transactions and live behavior are unverified.", databaseSignals));
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

  const capabilityRequests = [];
  if (snapshot.inventory.manifests.length > 0) capabilityRequests.push(capability("dependency-install", "dependency-install", "Reproduce dependencies from committed lockfiles in isolation.", snapshot.inventory.manifests, "medium"));
  capabilityRequests.push(capability("network-research", "network-research", "Consult current official practices for detected technologies while treating web content as untrusted input.", snapshot.detected.frameworks.length > 0 ? snapshot.detected.frameworks : ["repository"], "low"));
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

  const body = {
    schema_version: 1,
    repository_identity: snapshot.repository.identity,
    ...(snapshot.repository.git.head_sha ? { commit_sha: snapshot.repository.git.head_sha } : {}),
    workspace: { dirty: snapshot.repository.git.dirty, changed_file_count: snapshot.repository.git.changed_file_count },
    mode: "read-only-plan",
    verdict: snapshot.repository.git.head_sha ? "needs-evidence" : "blocked",
    claims,
    coverage,
    capability_requests: capabilityRequests,
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
  const confirmed = plan.claims.filter((item) => ["code-confirmed", "test-confirmed", "runtime-observed"].includes(item.status));
  const lines = [
    "Repository Understanding Brief",
    `Verdict: ${plan.verdict}`,
    `Repository: ${plan.repository_identity}`,
    `Revision: ${plan.commit_sha ?? "no committed revision"}`,
    `Confirmed claims: ${confirmed.length}/${plan.claims.length}`,
    "Runtime note: project commands, app surfaces, browser/simulator and database were not executed by this onboarding plan.",
    "",
    "Highest-priority gaps:"
  ];
  for (const blocker of plan.blockers.slice(0, 5)) lines.push(`- ${blocker.summary}`);
  lines.push("", `Authority requests: ${plan.capability_requests.map((request) => request.capability).join(", ") || "none"}`);
  lines.push(`Next: ${plan.next_action.label}`);
  return lines.join("\n");
}
