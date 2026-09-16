import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SchemaRegistry } from "../../schema/src/validator.mjs";
import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { readProjectConfig } from "../src/config.mjs";
import { discoverRepository } from "../src/discover.mjs";
import { evaluateReadiness, formatReadinessReport } from "../src/doctor.mjs";
import { initializeProject, proposeProjectConfig } from "../src/init.mjs";
import { createOnboardingPlan, formatRepositoryUnderstandingBrief } from "../src/onboard.mjs";
import { createProjectDeclarationReview } from "../src/project-declaration-review.mjs";
import { compileProjectHarness } from "../src/harness.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

async function contractRegistry() {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const schemaDirectory = path.resolve(testDirectory, "../../schema/schemas/v1");
  const schemas = await Promise.all(
    (await readdir(schemaDirectory))
      .filter((name) => name.endsWith(".schema.json"))
      .map(async (name) => JSON.parse(await readFile(path.join(schemaDirectory, name), "utf8")))
  );
  return new SchemaRegistry(schemas);
}

async function createWebRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-web-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "sample-web",
        scripts: { build: "next build", test: "node --test", dev: "next dev" },
        dependencies: { next: "15.0.0", react: "19.0.0" },
        devDependencies: { "@playwright/test": "1.0.0" }
      },
      null,
      2
    )
  );
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(path.join(root, "playwright.config.ts"), "export default {};\n");
  await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n");
  await writeFile(path.join(root, ".env.example"), "DATABASE_URL=example\nAPI_TOKEN=\n");
  await writeFile(path.join(root, ".env"), "DATABASE_URL=postgres://local\nAPI_TOKEN=super-secret-test-value\n");
  await writeFile(path.join(root, ".gitignore"), ".env\n");
  await writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: ci\n");

  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "devharness@example.invalid"]);
  git(root, ["config", "user.name", "DevHarness Tests"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  git(root, ["remote", "add", "origin", "git@github.com:example/sample-web.git"]);
  return root;
}

test("discovery detects a web repository without leaking environment values", async (t) => {
  const root = await createWebRepository(t);
  const snapshot = await discoverRepository(root);

  assert.deepEqual(snapshot.detected.platforms, ["web"]);
  assert.ok(snapshot.detected.frameworks.includes("Next.js"));
  assert.ok(snapshot.detected.test_tools.includes("Playwright"));
  assert.ok(snapshot.detected.ci_files.includes(".github/workflows/ci.yml"));
  assert.ok(snapshot.commands.some((command) => command.kind === "build"));
  assert.ok(snapshot.commands.some((command) => command.kind === "verify"));
  assert.deepEqual(snapshot.environment.local_files, [".env"]);
  assert.equal(snapshot.environment.local_files_ignored, true);
  assert.ok(snapshot.environment.locally_set_keys.includes("API_TOKEN"));
  assert.equal(JSON.stringify(snapshot).includes("super-secret-test-value"), false);
  assert.equal(snapshot.repository.identity, "github.com/example/sample-web");
  const trustContext = await loadTrustedEvaluationContext({ snapshot });
  assert.equal(trustContext.inventory.databaseRequired, true);
  assert.ok(trustContext.inventory.expectedDomains.includes("backend"));
});

test("discovery, doctor, and init outputs satisfy their public schemas", async (t) => {
  const root = await createWebRepository(t);
  const snapshot = await discoverRepository(root);
  const report = evaluateReadiness(snapshot);
  const config = proposeProjectConfig(snapshot);
  const registry = await contractRegistry();

  assert.deepEqual(
    registry.validate("https://devharness.dev/schemas/v1/repository-snapshot.schema.json", snapshot),
    { valid: true, errors: [] }
  );
  assert.deepEqual(
    registry.validate("https://devharness.dev/schemas/v1/readiness-report.schema.json", report),
    { valid: true, errors: [] }
  );
  assert.deepEqual(
    registry.validate("https://devharness.dev/schemas/v1/project-config.schema.json", config),
    { valid: true, errors: [] }
  );
});

test("doctor distinguishes discovered commands from executed proof", async (t) => {
  const root = await createWebRepository(t);
  const before = evaluateReadiness(await discoverRepository(root));
  assert.equal(before.overall.verdict, "needs_work");
  assert.ok(before.biggest_blockers.includes("project-config"));

  await initializeProject(await discoverRepository(root), { write: true });
  const after = evaluateReadiness(await discoverRepository(root));
  assert.equal(after.overall.verdict, "needs_work");
  assert.equal(after.overall.level, 1);
  assert.match(formatReadinessReport(after), /lack Supervisor-issued evidence/);
});

test("production compose files are detected as services but never proposed as commands", async (t) => {
  const root = await createWebRepository(t);
  await writeFile(path.join(root, "docker-compose.prod.yml"), "services:\n  db:\n    image: postgres:17\n");
  const snapshot = await discoverRepository(root);
  assert.ok(snapshot.detected.services.includes("Docker Compose"));
  assert.ok(snapshot.detected.services.includes("PostgreSQL"));
  assert.ok(snapshot.detected.deployment_files.includes("docker-compose.prod.yml"));
  assert.equal(snapshot.commands.some((command) => command.source === "docker-compose.prod.yml"), false);
});

test("initialized submodules retain their leading status marker", async (t) => {
  const root = await createWebRepository(t);
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-submodule-"));
  t.after(() => rm(moduleRoot, { recursive: true, force: true }));
  git(moduleRoot, ["init", "-b", "main"]);
  git(moduleRoot, ["config", "user.email", "devharness@example.invalid"]);
  git(moduleRoot, ["config", "user.name", "DevHarness Tests"]);
  await writeFile(path.join(moduleRoot, "README.md"), "fixture\n");
  git(moduleRoot, ["add", "."]);
  git(moduleRoot, ["commit", "-m", "fixture"]);
  git(root, ["-c", "protocol.file.allow=always", "submodule", "add", moduleRoot, "vendor/example"]);
  git(root, ["commit", "-am", "add initialized submodule"]);

  const snapshot = await discoverRepository(root);
  assert.deepEqual(snapshot.submodules.map(({ path: relative, status }) => ({ path: relative, status })), [{ path: "vendor/example", status: "initialized" }]);
});

test("init is a dry run by default and refuses to overwrite project configuration", async (t) => {
  const root = await createWebRepository(t);
  const snapshot = await discoverRepository(root);
  const proposal = proposeProjectConfig(snapshot);
  assert.deepEqual(proposal.autonomy.required_gates, ["scope", "delivery"]);
  assert.equal(proposal.delivery.provider, "github");

  const dryRun = await initializeProject(snapshot);
  await assert.rejects(readFile(path.join(root, "devharness.yaml"), "utf8"), { code: "ENOENT" });
  assert.equal(dryRun.written, false);
  assert.match(dryRun.content, /"quality"/);

  await initializeProject(snapshot, { write: true });
  assert.deepEqual((await readProjectConfig(root)).config, proposal);
  await assert.rejects(initializeProject(snapshot, { write: true }), { code: "EEXIST" });
});

test("init proposes lifecycle bindings when a Playwright base URL is available", async (t) => {
  const root = await createWebRepository(t);
  await writeFile(
    path.join(root, "playwright.config.ts"),
    [
      "export default {",
      "  use: {",
      "    baseURL: 'http://127.0.0.1:3000'",
      "  }",
      "};",
      ""
    ].join("\n")
  );

  const snapshot = await discoverRepository(root);
  const proposal = proposeProjectConfig(snapshot);

  assert.equal(proposal.harness.services.length, 1);
  assert.deepEqual(proposal.harness.services[0], {
    id: "root-dev-service",
    command_id: "root-dev",
    readiness: {
      kind: "http",
      url: "http://127.0.0.1:3000",
      expected_statuses: [200],
      timeout_ms: 60000,
      interval_ms: 1000
    },
    shutdown: {
      grace_ms: 1000
    }
  });
  assert.deepEqual(proposal.harness.verifications, [
    {
      command_id: "web-playwright",
      service_ids: ["root-dev-service"],
      warmup: []
    }
  ]);
});

test("project declaration review quantifies structural gaps without trusting discovery", async (t) => {
  const root = await createWebRepository(t);
  const snapshot = await discoverRepository(root);
  const config = proposeProjectConfig(snapshot);
  const review = await createProjectDeclarationReview(snapshot, config);

  assert.equal(review.verdict, "blocked");
  assert.equal(review.approval_available, false);
  assert.equal(review.structural_coverage, 55);
  assert.deepEqual(review.counts, {
    commands: 4,
    launch_commands: 1,
    configured_services: 0,
    verification_jobs: 1,
    service_bound_verifications: 0,
    blockers: 2
  });
  assert.ok(review.blockers.some((blocker) => blocker.code === "interactive-verification-unbound"));
  assert.equal(review.decision.id, "confirm-autonomous-test-runtime");
  assert.equal(JSON.stringify(review).includes("super-secret-test-value"), false);
});

test("review and harness compilation can opt into a dirty local preview without relaxing the baseline warning", async (t) => {
  const root = await createWebRepository(t);
  await writeFile(path.join(root, "local-preview-note.txt"), "preview-only\n");
  const snapshot = await discoverRepository(root);
  const config = proposeProjectConfig(snapshot);

  await assert.rejects(compileProjectHarness(snapshot, config), /clean committed baseline/);

  const harness = await compileProjectHarness(snapshot, config, { allowDirtyBaseline: true });
  assert.equal(harness.blockers.length > 0, true);

  const review = await createProjectDeclarationReview(snapshot, config, { allowDirtyBaseline: true });
  assert.equal(review.verdict, "blocked");
  assert.equal(review.dimensions.find((item) => item.id === "repository-baseline").status, "missing");
  assert.equal(review.dimensions.find((item) => item.id === "repository-baseline").earned, 0);
});

test("doctor reports unsafe environment handling without exposing the value", async (t) => {
  const root = await createWebRepository(t);
  await writeFile(path.join(root, ".gitignore"), "");
  const snapshot = await discoverRepository(root);
  const report = evaluateReadiness(snapshot);
  const environment = report.capabilities.find((item) => item.id === "environment-contract");
  assert.equal(environment.status, "fail");
  assert.equal(JSON.stringify(report).includes("super-secret-test-value"), false);
});

test("doctor rejects locally set keys omitted from the redacted example", async (t) => {
  const root = await createWebRepository(t);
  await writeFile(path.join(root, ".env.example"), "DATABASE_URL=example\n");
  const snapshot = await discoverRepository(root);
  const report = evaluateReadiness(snapshot);
  const environment = report.capabilities.find((item) => item.id === "environment-contract");
  assert.equal(environment.status, "fail");
  assert.deepEqual(environment.evidence, ["API_TOKEN"]);
  assert.equal(JSON.stringify(report).includes("super-secret-test-value"), false);
});

test("onboarding remains honest about detected web and database capabilities", async (t) => {
  const root = await createWebRepository(t);
  await writeFile(path.join(root, "compose.yml"), "services:\n  db:\n    image: postgres:17\n");
  const snapshot = await discoverRepository(root);
  const report = evaluateReadiness(snapshot);
  const registry = await contractRegistry();
  const plan = await createOnboardingPlan(snapshot, { report, config: null, configError: "missing" });
  const summary = plan.summary;
  const claimedTotal = Object.values(summary.claim_status_counts).reduce((total, value) => total + value, 0);
  const coverageTotal = Object.values(summary.coverage_status_counts).reduce((total, value) => total + value, 0);

  assert.equal(plan.mode, "read-only-plan");
  assert.equal(plan.workspace.dirty, true);
  assert.equal(plan.verdict, "needs-evidence");
  assert.ok(plan.execution_plan);
  assert.deepEqual(registry.validate("https://devharness.dev/schemas/v1/execution-plan.schema.json", plan.execution_plan), { valid: true, errors: [] });
  assert.equal(summary.total_claims, plan.claims.length);
  assert.equal(claimedTotal, plan.claims.length);
  assert.equal(coverageTotal, plan.coverage.length);
  assert.equal(summary.domain_knownness.database.total_claims >= 1, true);
  assert.equal(summary.domain_knownness.database.subdomains.schema.total_claims >= 1, true);
  assert.equal(summary.domain_knownness.frontend.total_claims >= 1, true);
  assert.equal(summary.domain_knownness.frontend.subdomains.routes.total_claims >= 1, true);
  assert.equal(summary.domain_knownness.backend.total_claims >= 1, true);
  assert.equal(summary.domain_knownness.backend.subdomains.api_contracts.total_claims >= 1, true);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Execution graph:/i);
  assert.ok(summary.priority_domains[0].startsWith("database="));
  assert.ok(plan.claims.some((claim) => claim.domain === "database" && claim.status === "detected"));
  assert.ok(plan.capability_requests.some((request) => request.capability === "database-runtime"));
  assert.ok(plan.capability_requests.some((request) => request.capability === "browser-runtime"));
  assert.match(formatRepositoryUnderstandingBrief(plan), /Understanding summary:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Claim states:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Execution graph:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Plan sketch:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Likely crew:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Acceptance checkpoints:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Execution waves:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Critical path:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /database detail:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /frontend detail:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /backend detail:/i);
  const agentRuntime = plan.capability_requests.find((request) => request.capability === "agent-runtime");
  assert.ok(agentRuntime);
  assert.equal(agentRuntime.operation, "analyze-goal-read-only");
  assert.equal(agentRuntime.risk, "high");
  assert.equal(agentRuntime.authority, "human-only");
  assert.equal(agentRuntime.reversibility, "Revocable before each external attempt; historical outputs remain labeled.");
  assert.match(agentRuntime.target, /^[0-9a-f]{64}$/);
  assert.ok(agentRuntime.scope.some((item) => item.startsWith("repository:")));
  assert.ok(agentRuntime.scope.some((item) => item.startsWith("revision:")));
  assert.ok(agentRuntime.scope.some((item) => item.startsWith("provider-origin:")));
  assert.ok(agentRuntime.scope.includes("no-consumer-write"));
  const vcsWrite = plan.capability_requests.find((request) => request.capability === "vcs-write");
  assert.ok(vcsWrite);
  assert.equal(vcsWrite.authority, "human-only");
  assert.ok(vcsWrite.scope.includes("isolated-worktree-only"));
  assert.equal(JSON.stringify(plan).includes("super-secret-test-value"), false);
  assert.equal(plan.coverage.find((item) => item.domain === "repository").status, "unverified");
  assert.ok(plan.preflight.clarification_questions.length > 0);
  assert.ok(plan.preflight.research_topics.length > 0);
  assert.ok(plan.preflight.research_tasks.length > 0);
  assert.ok(plan.preflight.clarification_questions.every((question) => typeof question.question === "string" && question.question.length > 0));
  assert.ok(plan.preflight.research_topics.every((topic) => typeof topic.query === "string" && topic.query.length > 0));
  assert.ok(plan.preflight.research_topics.every((topic) => topic.query.length <= 1000));
  assert.ok(plan.preflight.research_topics.every((topic) => typeof topic.owner === "string" && topic.owner.length > 0));
  assert.ok(plan.preflight.research_tasks.every((task) => task.approval_capability === "network-research"));
  assert.ok(plan.preflight.research_tasks.every((task) => task.query.length <= 1000));
  assert.equal(plan.capability_requests.filter((request) => request.capability === "network-research").length, plan.preflight.research_tasks.length);
  assert.ok(plan.preflight.research_tasks.every((task) => plan.capability_requests.some((request) => request.id === task.id && request.operation === "research")));
  assert.ok(plan.preflight.team_decomposition.length > 0);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Preflight path:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Clarification queue:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Preflight research:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Team decomposition:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Authority requests: .*network-research/i);
  const trustContext = await loadTrustedEvaluationContext({ snapshot });
  assert.equal(trustContext.inventory.databaseRequired, true);
  assert.ok(trustContext.inventory.expectedDomains.includes("backend"));
});

test("onboarding brief surfaces conflicts before general gaps", async (t) => {
  const root = await createWebRepository(t);
  const snapshot = await discoverRepository(root);
  const report = evaluateReadiness(snapshot);
  const plan = await createOnboardingPlan(snapshot, { report, config: null, configError: "conflicting declaration" });
  const brief = formatRepositoryUnderstandingBrief(plan);

  assert.equal(plan.summary.conflict_claims, 1);
  assert.equal(plan.summary.domain_knownness.database.total_claims >= 0, true);
  assert.match(brief, /Conflicts:/i);
  assert.match(brief, /repository:/i);
  assert.match(brief, /Domain knownness:/i);
  assert.ok(brief.indexOf("Conflicts:") < brief.indexOf("Highest-priority gaps:"));
});

test("generic command receipts never become real-surface runtime observation", async (t) => {
  const root = await createWebRepository(t);
  const snapshot = await discoverRepository(root);
  const report = evaluateReadiness(snapshot);
  for (const id of ["service-launch", "behavior-verification"]) report.capabilities.find((item) => item.id === id).status = "pass";
  const plan = await createOnboardingPlan(snapshot, { report, config: {}, configError: null });
  assert.equal(plan.claims.find((item) => item.id === "runtime-surface").status, "unverified");
  assert.match(plan.claims.find((item) => item.id === "runtime-surface").summary, /do not prove/i);
});
