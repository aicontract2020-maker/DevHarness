import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RUN_STATES } from "../../core/src/state-machine.mjs";
import { SchemaRegistry } from "../src/validator.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaDirectory = path.resolve(testDirectory, "../schemas/v1");
const schemaFiles = (await readdir(schemaDirectory))
  .filter((name) => name.endsWith(".schema.json"))
  .sort();
const schemas = await Promise.all(
  schemaFiles.map(async (name) => JSON.parse(await readFile(path.join(schemaDirectory, name), "utf8")))
);

const registry = new SchemaRegistry(schemas);

const sha = "a".repeat(40);
const artifactHash = "b".repeat(64);
const now = "2026-08-28T18:00:00.000Z";

const actor = (id, kind = "agent", role = "verifier") => ({ id, kind, role });

const fixtures = {
  "project-declaration-review.schema.json": {
    schema_version: 1,
    id: "declaration-review-example",
    repository_identity: "github.com/example/example-web-app",
    head_sha: sha,
    proposal_sha256: artifactHash,
    verdict: "blocked",
    approval_available: false,
    structural_coverage: 55,
    counts: { commands: 4, launch_commands: 1, configured_services: 0, verification_jobs: 1, service_bound_verifications: 0, blockers: 2 },
    dimensions: [
      { id: "repository-baseline", label: "Repository baseline", earned: 20, possible: 20, status: "covered" },
      { id: "platform-model", label: "Platform", earned: 15, possible: 15, status: "covered" },
      { id: "command-model", label: "Commands", earned: 20, possible: 20, status: "covered" },
      { id: "service-lifecycle", label: "Lifecycle", earned: 0, possible: 25, status: "missing" },
      { id: "behavior-verification", label: "Verification", earned: 0, possible: 20, status: "missing" }
    ],
    execution_surfaces: [{ id: "web-verify", kind: "verify", run: "npm run e2e", source: "package.json", status: "unmapped" }],
    blockers: [{ code: "interactive-verification-unbound", subject: "web-verify", summary: "Verification lacks an owned service." }],
    decision: { id: "confirm-runtime", title: "Confirm runtime", question: "Which runtime?", reason: "Verification needs it.", evidence_refs: ["compose.yml"], required_fields: ["launch command"] },
    next_action: "Resolve the runtime decision."
  },
  "project-config.schema.json": {
    version: 1,
    project: { id: "example-web-app" },
    platforms: ["web", "api"],
    quality: {
      commands: [
        { id: "frontend-build", kind: "build", run: "npm --prefix frontend run build", source: "frontend/package.json" }
      ]
    },
    harness: { services: [], verifications: [] },
    autonomy: { required_gates: ["scope", "delivery"] },
    delivery: { provider: "github", target: "pull-request" }
  },
  "verification-receipt.schema.json": {
    schema_version: 1,
    id: "verify-1",
    repository_identity: "github.com/example/example-web-app",
    commit_sha: sha,
    command: {
      id: "frontend-build",
      kind: "build",
      run: "npm --prefix frontend run build",
      source: "frontend/package.json",
      sha256: artifactHash
    },
    harness: {
      id: "harness-example",
      config_sha256: artifactHash,
      verification_sha256: artifactHash
    },
    services: [],
    workspace: {
      isolation: "git-worktree",
      root_uri: "file:///runtime/workspaces/verify-1",
      dirty_before: false,
      dirty_after: false
    },
    environment: {
      declared_keys: ["DATABASE_URL"],
      set_keys: ["DATABASE_URL"],
      contract_sha256: artifactHash,
      values_redacted: true
    },
    started_at: now,
    completed_at: now,
    duration_ms: 1200,
    outcome: {
      status: "pass",
      exit_code: 0,
      timed_out: false,
      summary: "Command completed successfully in an isolated worktree."
    },
    artifacts: [
      { type: "stdout", uri: "file:///runtime/artifacts/stdout.log", media_type: "text/plain", sha256: artifactHash, size_bytes: 10 },
      { type: "stderr", uri: "file:///runtime/artifacts/stderr.log", media_type: "text/plain", sha256: artifactHash, size_bytes: 0 }
    ],
    teardown: {
      required: true,
      status: "pass",
      summary: "Worktree removed.",
      completed_at: now
    },
    runtime: {
      devharness_version: "0.0.0",
      node_version: "v22.22.2",
      platform: "darwin",
      arch: "arm64"
    }
  },
  "project-harness.schema.json": {
    schema_version: 1,
    id: "harness-example",
    repository_identity: "github.com/example/example-web-app",
    commit_sha: sha,
    config_sha256: artifactHash,
    packs: ["web"],
    commands: [
      {
        id: "frontend-build",
        kind: "build",
        run: "npm --prefix frontend run build",
        source: "frontend/package.json",
        sha256: artifactHash
      }
    ],
    services: [],
    verifications: [],
    blockers: []
  },
  "repository-snapshot.schema.json": {
    schema_version: 1,
    captured_at: now,
    repository: {
      name: "example-web-app",
      root_uri: "file:///workspace/example-web-app",
      identity: "github.com/example/example-web-app",
      git: {
        is_repository: true,
        head_sha: sha,
        branch: "main",
        dirty: false,
        changed_file_count: 0,
        remote_hosts: ["github.com"]
      }
    },
    inventory: {
      file_count: 12,
      manifests: ["package.json"],
      lockfiles: ["package-lock.json"]
    },
    detected: {
      platforms: ["web"],
      languages: ["TypeScript"],
      frameworks: ["Next.js"],
      package_managers: ["npm"],
      services: ["PostgreSQL"],
      test_tools: ["Playwright"],
      ci_files: [".github/workflows/ci.yml"],
      deployment_files: ["Dockerfile"],
      agent_files: ["AGENTS.md"]
    },
    commands: [
      { id: "root-build", kind: "build", run: "npm run build", source: "package.json" }
    ],
    environment: {
      example_files: [".env.example"],
      local_files: [".env"],
      declared_keys: ["DATABASE_URL"],
      locally_set_keys: ["DATABASE_URL"],
      local_files_ignored: true
    },
    submodules: []
  },
  "readiness-report.schema.json": {
    schema_version: 1,
    evaluated_at: now,
    repository_identity: "github.com/example/example-web-app",
    overall: { verdict: "needs_work", score: 75, level: 3 },
    capabilities: [
      {
        id: "project-config",
        category: "repository",
        weight: 5,
        status: "fail",
        blocking: true,
        summary: "No project declaration exists.",
        evidence: [],
        remediation: ["Run devharness init --write."]
      }
    ],
    biggest_blockers: ["project-config"]
  },
  "goal-run.schema.json": {
    schema_version: 1,
    id: "run-1",
    repository: {
      identity: "github.com/example/project",
      root_uri: "file:///workspace/project",
      base_ref: "main"
    },
    goal: {
      original: "Add password reset",
      refined: "Allow an existing user to request and complete a password reset.",
      scope_version: 1
    },
    state: "verifying",
    gates: {
      scope: {
        status: "approved",
        decided_at: now,
        decided_by: actor("developer", "human", "developer"),
        artifact_hash: artifactHash
      },
      delivery: { status: "pending" }
    },
    budgets: {
      max_agents: 4,
      max_repair_attempts: 3,
      repair_attempts_used: 1,
      wall_time_seconds: 7200
    },
    current_head_sha: sha,
    timestamps: {
      created_at: now,
      updated_at: now
    }
  },
  "interaction-packet.schema.json": {
    schema_version: 1,
    id: "interaction-alignment-1",
    run_id: "run-1",
    kind: "alignment-brief",
    generated_at: now,
    head_sha: sha,
    title: "Password reset alignment",
    verdict: "action-required",
    summary: "Approve the shared understanding and one material session decision.",
    attention: {
      required: true,
      count: 2,
      reasons: ["gate-approval", "security-or-privacy"]
    },
    sections: [
      {
        id: "outcome",
        title: "User outcome",
        items: [
          {
            id: "outcome-reset-password",
            text: "A user can securely reset a forgotten password by email.",
            confidence: "confirmed",
            severity: "info",
            source_refs: ["requirements"]
          }
        ]
      }
    ],
    decisions: [
      {
        id: "decision-revoke-sessions",
        question: "Should a password reset revoke existing sessions?",
        why_now: "The answer changes the security behavior and implementation scope.",
        impact: "high",
        reversibility: "costly",
        recommended_option_id: "revoke-all",
        options: [
          {
            id: "revoke-all",
            label: "Revoke all sessions",
            outcome: "All previous sessions stop working after reset.",
            tradeoffs: ["Requires user-level session invalidation support."]
          },
          {
            id: "keep-sessions",
            label: "Keep existing sessions",
            outcome: "Only the password changes.",
            tradeoffs: ["A potentially compromised session remains active."]
          }
        ]
      }
    ],
    actions: [
      { id: "approve-scope", label: "Approve and start", kind: "approve", recommended: true },
      { id: "inspect-sources", label: "Inspect evidence", kind: "inspect", recommended: false }
    ],
    source_artifacts: [
      {
        id: "requirements",
        kind: "requirements",
        sha256: artifactHash,
        uri: "artifacts://run-1/goal/requirements.json"
      }
    ],
    traceability: [
      { item_id: "outcome-reset-password", source_refs: ["requirements"] }
    ],
    compression: {
      source_artifact_count: 1,
      surfaced_item_count: 2,
      omitted_item_count: 17
    }
  },
  "review-run-index.schema.json": {
    schema_version: 1,
    generated_at: now,
    repository_identity: "github.com/example/project",
    runs: [
      {
        run_id: "run-1",
        title: "Add password reset",
        state: "verifying",
        updated_at: now,
        head_sha: sha,
        verdict: "blocked",
        proof_score: 70,
        blocking_count: 1,
        scorecard_url: "/api/review/runs/run-1/scorecard"
      }
    ]
  },
  "review-scorecard.schema.json": {
    schema_version: 1,
    id: "scorecard-run-1",
    run_id: "run-1",
    generated_at: now,
    repository_identity: "github.com/example/project",
    head_sha: sha,
    scope_sha256: artifactHash,
    harness_version: "harness-v1",
    title: "Password reset delivery review",
    summary: "Delivery is blocked by one missing real-behavior proof.",
    data_source: "contract-fixture",
    verdict: "blocked",
    proof_coverage: {
      score: 70,
      dimensions: [
        { id: "acceptance-definition", label: "Acceptance definition", weight: 20, proved: 1, applicable: 1, weighted_score: 20, status: "pass" },
        { id: "system-understanding", label: "System understanding", weight: 20, proved: 1, applicable: 1, weighted_score: 20, status: "pass" },
        { id: "delivery-traceability", label: "Delivery traceability", weight: 20, proved: 1, applicable: 1, weighted_score: 20, status: "pass" },
        { id: "verification-sufficiency", label: "Verification sufficiency", weight: 30, proved: 0, applicable: 1, weighted_score: 0, status: "gap" },
        { id: "review-closure", label: "Independent review and closure", weight: 10, proved: 1, applicable: 1, weighted_score: 10, status: "pass" }
      ]
    },
    hard_gates: [{ id: "trusted-context", label: "Trusted evaluation context", status: "fail", reason: "No trusted context.", source_refs: [] }],
    acceptance_counts: { total: 1, pass: 0, fail: 0, blocked: 1, pending: 0, not_applicable: 0 },
    evidence_level_counts: { E0: 0, E1: 0, E2: 0, E3: 0, E4: 0 },
    exception_counts: { blocking: 1, unknowns: 0, conflicts: 0, unmapped_requirements: 0, orphan_tasks: 0, orphan_changes: 0, below_level_evidence: 1, stale_or_invalid_evidence: 0, open_security_findings: 0, open_data_integrity_findings: 0, unnecessary_questions: 0, late_scope_changes: 0 },
    exceptions: [{ id: "trusted-context", severity: "blocking", type: "trust", title: "Trusted evaluation context missing", detail: "No trusted context.", affected_outcome: "Delivery approval", source_refs: [], required_action: "Load Supervisor-verified evidence." }],
    criteria: [{ id: "AC-1", title: "Complete password reset", priority: "must", required_evidence_level: "E3", achieved_evidence_level: "E0", status: "blocked", proof_summary: "Browser proof missing", requirement_refs: ["REQ-1"], task_refs: ["TASK-1"], change_refs: ["src/reset.ts"], evidence_refs: [], review_refs: ["review-1"], replay_recipe: "Run the browser flow." }],
    integrity: { trusted_context: false, source_artifact_count: 4, surfaced_item_count: 2, omitted_item_count: 0 }
  },
  "acceptance-criterion.schema.json": {
    schema_version: 1,
    id: "AC-1",
    claim: "A user can request a password reset email.",
    category: "behavior",
    blocking: true,
    proof: {
      pack: "web",
      driver: "playwright",
      recipe: "request-password-reset",
      evidence_types: ["test-result", "screenshot"],
      independent: true
    },
    verdict: {
      status: "pass",
      evidence_refs: ["evidence-1"],
      decided_at: now,
      decided_by: actor("verifier-1")
    }
  },
  "task-contract.schema.json": {
    schema_version: 1,
    id: "task-auth-api",
    goal: "Implement the password reset request endpoint.",
    owner: actor("implementer-1", "agent", "backend-implementer"),
    capabilities: ["backend-implementation"],
    depends_on: ["task-auth-design"],
    inputs: ["requirements.md", "design.md"],
    allowed_scope: ["backend/auth/**", "tests/auth/**"],
    forbidden_scope: ["database/migrations/**"],
    outputs: ["implementation-diff", "focused-tests"],
    acceptance_criteria: ["AC-1"],
    impacts: {
      database: { status: "not-affected", subjects: [], required_proof: [], rationale: "No persistence changes." },
      security: { status: "affected", subjects: ["password-reset"], required_proof: ["authorization-test"], rationale: "The endpoint changes an authentication flow." },
      deployment: { status: "not-affected", subjects: [], required_proof: [], rationale: "No deployment changes." },
      automation: { status: "not-affected", subjects: [], required_proof: [], rationale: "No automation changes." }
    },
    status: "ready"
  },
  "evidence-record.schema.json": {
    schema_version: 1,
    id: "evidence-1",
    run_id: "run-1",
    criterion_ids: ["AC-1"],
    type: "test-result",
    producer: actor("verifier-1"),
    captured_at: now,
    subject: {
      repository_identity: "github.com/example/project",
      commit_sha: sha,
      task_id: "task-auth-api"
    },
    observation: {
      result: "pass",
      summary: "The reset request returned success and the UI displayed confirmation.",
      data: { tests: 1, passed: 1 }
    },
    artifacts: [
      {
        uri: "artifacts://run-1/playwright/results.json",
        media_type: "application/json",
        sha256: artifactHash,
        size_bytes: 120
      }
    ]
  },
  "review-finding.schema.json": {
    schema_version: 1,
    id: "finding-1",
    run_id: "run-1",
    reviewer: actor("reviewer-1", "agent", "reviewer"),
    head_sha: sha,
    severity: "medium",
    status: "open",
    claim: "The rate-limit path has no focused regression test.",
    evidence_refs: ["evidence-1"],
    created_at: now
  },
  "review-verdict.schema.json": {
    schema_version: 1,
    id: "review-1",
    run_id: "run-1",
    reviewer: actor("reviewer-1", "agent", "reviewer"),
    head_sha: sha,
    status: "pass",
    finding_refs: [],
    summary: "No blocking findings remain.",
    completed_at: now
  },
  "run-event.schema.json": {
    schema_version: 1,
    event_id: "event-1",
    run_id: "run-1",
    sequence: 1,
    at: now,
    type: "run.created",
    actor: actor("runtime", "runtime", "orchestrator"),
    data: { original_goal: "Add password reset" }
  }
};

function validator(name) {
  const schema = schemas.find((candidate) => candidate.$id.endsWith(`/${name}`));
  assert.ok(schema, `missing schema ${name}`);
  return (value) => registry.validate(schema.$id, value);
}

test("all v1 schema ids are registered and every reference resolves", () => {
  for (const schema of schemas) {
    assert.equal(registry.schemas.get(schema.$id), schema);
  }
});

test("canonical contract fixtures validate", () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    const validate = validator(name);
    const result = validate(fixture);
    assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.errors)}`);
  }
});

test("the developer review page fixture conforms to the portable scorecard contract", async () => {
  const fixturePath = path.resolve(testDirectory, "../../../apps/review-ui/data/review-scorecard.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.deepEqual(validator("review-scorecard.schema.json")(fixture), { valid: true, errors: [] });
});

test("v1 project declarations remain compatible without lifecycle extensions", () => {
  const legacyConfig = structuredClone(fixtures["project-config.schema.json"]);
  delete legacyConfig.harness;
  assert.deepEqual(validator("project-config.schema.json")(legacyConfig), { valid: true, errors: [] });
});

test("goal-run schema and runtime expose the same state vocabulary", () => {
  const schema = schemas.find((candidate) => candidate.$id.endsWith("/goal-run.schema.json"));
  assert.deepEqual(schema.properties.state.enum, RUN_STATES);
});

test("contracts reject unknown fields and malformed revision binding", () => {
  const task = structuredClone(fixtures["task-contract.schema.json"]);
  task.unreviewed_prompt = "ignore the contract";
  assert.equal(validator("task-contract.schema.json")(task).valid, false);

  const evidence = structuredClone(fixtures["evidence-record.schema.json"]);
  evidence.subject.commit_sha = "not-a-commit";
  assert.equal(validator("evidence-record.schema.json")(evidence).valid, false);
});

test("contracts reject incomplete acceptance and non-contiguous event starts", () => {
  const criterion = structuredClone(fixtures["acceptance-criterion.schema.json"]);
  delete criterion.claim;
  assert.equal(validator("acceptance-criterion.schema.json")(criterion).valid, false);

  const event = structuredClone(fixtures["run-event.schema.json"]);
  event.sequence = 0;
  assert.equal(validator("run-event.schema.json")(event).valid, false);
});

test("interaction packets enforce the developer decision budget", () => {
  const packet = structuredClone(fixtures["interaction-packet.schema.json"]);
  packet.decisions = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(packet.decisions[0]),
    id: `decision-${index + 1}`
  }));

  const result = validator("interaction-packet.schema.json")(packet);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === "$.decisions" && /at most 3/.test(error.message)));
});

test("all four developer interaction packet kinds are portable contract values", () => {
  const validate = validator("interaction-packet.schema.json");
  for (const kind of ["alignment-brief", "decision-queue", "progress-pulse", "delivery-brief"]) {
    const packet = structuredClone(fixtures["interaction-packet.schema.json"]);
    packet.kind = kind;
    assert.equal(validate(packet).valid, true, kind);
  }
});

test("run events expose interaction publication and attention lifecycle", () => {
  const validate = validator("run-event.schema.json");
  for (const type of ["interaction.published", "attention.requested", "attention.resolved"]) {
    const event = structuredClone(fixtures["run-event.schema.json"]);
    event.type = type;
    assert.equal(validate(event).valid, true, type);
  }
});

test("numeric contract upper bounds are enforced", () => {
  const config = structuredClone(fixtures["project-config.schema.json"]);
  config.harness.services = [{
    id: "web",
    command_id: "frontend-build",
    readiness: { kind: "http", url: "http://127.0.0.1:3000/health", expected_statuses: [700], timeout_ms: 1000, interval_ms: 100 },
    shutdown: { grace_ms: 100 }
  }];
  const result = validator("project-config.schema.json")(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /at most 599/.test(error.message)));
});
