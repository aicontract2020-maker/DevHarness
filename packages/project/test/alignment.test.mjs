import assert from "node:assert/strict";
import test from "node:test";

import { createInitialGoalRun } from "../../core/src/goal-run.mjs";
import { evaluateInteractionPacket } from "../../core/src/interaction-policy.mjs";
import { createGoalUnderstandingCheckpoint } from "../src/alignment.mjs";
import { formatRepositoryUnderstandingBrief } from "../src/onboard.mjs";

const head = "a".repeat(40);
const now = "2026-08-31T18:00:00.000Z";

function fixture() {
  const { run } = createInitialGoalRun({
    id: "run-alignment-1",
    repository: { identity: "example/project", root_uri: "file:///workspace/project", base_ref: "main" },
    originalGoal: "Add password reset",
    headSha: head,
    now
  });
  const snapshot = {
    schema_version: 1,
    captured_at: now,
    repository: {
      name: "project",
      root_uri: "file:///workspace/project",
      identity: "example/project",
      git: { is_repository: true, head_sha: head, branch: "main", dirty: false, changed_file_count: 0, remote_hosts: ["example"] }
    },
    inventory: { file_count: 20, manifests: ["package.json"], lockfiles: ["package-lock.json"] },
    detected: {
      platforms: ["web"], languages: ["TypeScript"], frameworks: ["Next.js"], package_managers: ["npm"],
      services: ["PostgreSQL"], test_tools: ["Playwright"], ci_files: [], deployment_files: [], agent_files: []
    },
    commands: [],
    environment: { example_files: [], local_files: [], declared_keys: [], locally_set_keys: [], local_files_ignored: true },
    submodules: []
  };
  const plan = {
    schema_version: 1,
    id: "onboard-example",
    generated_at: now,
    repository_identity: "example/project",
    commit_sha: head,
    workspace: { dirty: false, changed_file_count: 0 },
    mode: "read-only-plan",
    verdict: "needs-evidence",
    summary: {
      total_claims: 3,
      proved_claims: 1,
      unresolved_claims: 2,
      conflict_claims: 0,
      domain_knownness: {
        database: {
          total_claims: 5,
          known_claims: 0,
          unknown_claims: 4,
          conflict_claims: 0,
          subdomains: {
            schema: { total_claims: 1, known_claims: 0, unknown_claims: 1, conflict_claims: 0 },
            migrations: { total_claims: 1, known_claims: 0, unknown_claims: 1, conflict_claims: 0 },
            constraints: { total_claims: 1, known_claims: 0, unknown_claims: 1, conflict_claims: 0 },
            queries: { total_claims: 1, known_claims: 0, unknown_claims: 1, conflict_claims: 0 },
            ownership: { total_claims: 1, known_claims: 0, unknown_claims: 0, conflict_claims: 0 }
          }
        },
        frontend: {
          total_claims: 4,
          known_claims: 1,
          unknown_claims: 2,
          conflict_claims: 0,
          subdomains: {
            routes: { total_claims: 2, known_claims: 1, unknown_claims: 1, conflict_claims: 0 },
            state: { total_claims: 1, known_claims: 0, unknown_claims: 1, conflict_claims: 0 },
            user_flows: { total_claims: 1, known_claims: 0, unknown_claims: 0, conflict_claims: 0 }
          }
        },
        backend: {
          total_claims: 0,
          known_claims: 0,
          unknown_claims: 0,
          conflict_claims: 0,
          subdomains: {
            api_contracts: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            orchestration: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 },
            failure_paths: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0 }
          }
        }
      },
      claim_status_counts: {
        "code-confirmed": 1,
        "test-confirmed": 0,
        "runtime-observed": 0,
        detected: 1,
        documented: 0,
        conflict: 0,
        unverified: 0,
        "not-covered": 1
      },
      coverage_status_counts: {
        "code-confirmed": 1,
        "test-confirmed": 0,
        "runtime-observed": 0,
        detected: 1,
        documented: 0,
        conflict: 0,
        unverified: 0,
        "not-covered": 1,
        "not-applicable": 7
      },
      priority_domains: ["database=detected", "security=not-covered"]
    },
    claims: [
      { id: "repository-inventory", domain: "repository", status: "code-confirmed", summary: "Committed inventory inspected.", evidence_refs: [head] },
      { id: "database-surface", domain: "database", status: "detected", summary: "Database detected but not exercised.", evidence_refs: ["PostgreSQL"] },
      { id: "security-model", domain: "security", status: "not-covered", summary: "Security model is not proved.", evidence_refs: [] }
    ],
    coverage: [
      { domain: "repository", status: "code-confirmed", claim_ids: ["repository-inventory"] },
      { domain: "database", status: "detected", claim_ids: ["database-surface"] },
      { domain: "security", status: "not-covered", claim_ids: ["security-model"] }
    ],
    capability_requests: [],
    blockers: [
      { id: "coverage-database", summary: "database understanding is detected." },
      { id: "coverage-security", summary: "security understanding is not-covered." }
    ],
    limitations: ["No project command was executed."],
    next_action: { id: "approve-capability-plan", label: "Review capability plan", recommended: true }
  };
  return { run, snapshot, plan };
}

test("static understanding compiles a traceable, non-approvable Alignment Brief", async () => {
  const { run, snapshot, plan } = fixture();
  const result = await createGoalUnderstandingCheckpoint({ run, snapshot, onboardingPlan: plan, generatedAt: now });

  assert.equal(result.run.state, "clarifying");
  assert.equal(result.events.length, 6);
  assert.deepEqual(result.events.map((event) => event.sequence), [2, 3, 4, 5, 6, 7]);
  assert.equal(result.packet.kind, "alignment-brief");
  assert.equal(result.packet.verdict, "action-required");
  assert.equal(result.packet.actions.some((action) => action.kind === "approve"), false);
  assert.deepEqual(result.packet.attention.reasons, ["verification-blocker"]);
  assert.equal(result.packet.sections.length <= 5, true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-understanding-summary"), true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-domain-knownness"), true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-progress-summary"), true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-plan-crew"), true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-plan-checkpoints"), true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-plan-acceptance"), true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-stage-gates"), true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-stage-implement"), true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-stage-verify"), true);
  assert.equal(result.packet.sections[1].items.some((item) => item.id === "alignment-stage-deliver"), true);
  assert.equal(result.packet.sections.some((section) => section.title === "Execution graph"), true);
  assert.equal(result.packet.sections.find((section) => section.title === "Execution graph")?.items.some((item) => item.id === "alignment-execution-graph-summary"), true);
  assert.match(result.packet.sections.find((section) => section.title === "Confirmed project facts")?.items.find((item) => item.id === "alignment-plan-preflight")?.text ?? "", /Preflight path:/i);
  assert.match(result.packet.sections.find((section) => section.title === "Confirmed project facts")?.items.find((item) => item.id === "alignment-plan-preflight")?.text ?? "", /Clarification queue:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Plan sketch:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Likely crew:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Preflight path:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Acceptance checkpoints:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Execution graph:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Execution waves:/i);
  assert.match(formatRepositoryUnderstandingBrief(plan), /Critical path:/i);
  assert.equal(result.packet.sections.flatMap((section) => section.items).filter((item) => item.severity === "blocking").length > 0, true);
  assert.deepEqual(evaluateInteractionPacket(result.packet), { valid: true, reasons: [] });
  assert.equal(result.artifacts.length, 6);
  assert.equal(result.artifacts.some((entry) => entry.id === "artifact-understanding-baseline" && entry.kind === "repository-understanding-baseline"), true);
  assert.equal(result.artifacts.find((entry) => entry.id === "artifact-understanding-baseline")?.value?.verdict, "needs-evidence");
  assert.equal(result.artifacts.some((entry) => entry.id === "artifact-system-model" && entry.kind === "system-model"), true);
  assert.equal(result.artifacts.find((entry) => entry.id === "artifact-system-model")?.value?.verdict, "needs-evidence");
  assert.equal(result.artifacts.some((entry) => entry.id === "artifact-design-strategy" && entry.kind === "design-strategy"), true);
  assert.equal(result.artifacts.find((entry) => entry.id === "artifact-design-strategy")?.value?.status, "proposed");
  assert.equal(result.artifacts.every((artifact) => result.packet.source_artifacts.some((source) => source.id === artifact.id && source.sha256 === artifact.sha256)), true);
});

test("understanding refuses a stale or dirty repository snapshot", async () => {
  const { run, snapshot, plan } = fixture();
  await assert.rejects(createGoalUnderstandingCheckpoint({ run, snapshot: { ...snapshot, repository: { ...snapshot.repository, git: { ...snapshot.repository.git, dirty: true } } }, onboardingPlan: plan, generatedAt: now }), /clean committed/i);
  await assert.rejects(createGoalUnderstandingCheckpoint({ run, snapshot: { ...snapshot, repository: { ...snapshot.repository, git: { ...snapshot.repository.git, head_sha: "b".repeat(40) } } }, onboardingPlan: plan, generatedAt: now }), /revision/i);
});
