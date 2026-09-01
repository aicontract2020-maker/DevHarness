import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SchemaRegistry } from "../src/validator.mjs";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schemas/v1");
const registry = new SchemaRegistry(await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".schema.json")).map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")))));
const sha = "a".repeat(40);
const hash = "b".repeat(64);
const now = "2026-08-29T12:00:00.000Z";

function valid(name, value) {
  return registry.validate(`https://devharness.dev/schemas/v1/${name}.schema.json`, value);
}

test("understanding and authority contracts accept bounded revision-aware fixtures", () => {
  const authority = {
    schema_version: 1,
    id: "authority-1",
    repository_identity: "example/project",
    created_at: now,
    requests: [{ id: "browser", capability: "browser-runtime", operation: "install-and-run", target: "local-browser", scope: ["localhost"], reason: "Exercise the real UI.", risk: "medium", authority: "explicit", decision: "pending" }],
    status: "pending"
  };
  assert.deepEqual(valid("capability-request", authority), { valid: true, errors: [] });

  const baseline = {
    schema_version: 1,
    id: "baseline-1",
    repository_identity: "example/project",
    commit_sha: sha,
    captured_at: now,
    required_domains: ["repository", "database", "security"],
    claims: [{ id: "db", domain: "database", statement: "Writes are transactionally constrained.", status: "test-confirmed", severity: "info", source_refs: ["schema"], evidence_refs: ["db-test"], affected_paths: ["migrations/"] }],
    conflicts: [],
    models: { system_model_id: "system-1", database_covered: true, security_covered: true, feature_flows_covered: true },
    strategy: { strategy_id: "strategy-1", version: 1, status: "approved", artifact_sha256: hash },
    verdict: "ready"
  };
  assert.deepEqual(valid("repository-understanding-baseline", baseline), { valid: true, errors: [] });
});

test("system model and approved strategy express database, security and consistency", () => {
  const model = {
    schema_version: 1,
    id: "system-1",
    repository_identity: "example/project",
    commit_sha: sha,
    components: [{ id: "web", kind: "frontend", owner: "frontend" }, { id: "api", kind: "backend", owner: "backend" }],
    stores: [{ id: "main-db", kind: "PostgreSQL", disposable_test_available: true }],
    entities: [{ id: "user", store_id: "main-db", owner_component_id: "api", classifications: ["personal"], constraints: ["email unique"], indexes: ["email"], migration_refs: ["001"] }],
    trust_boundaries: [{ id: "web-api", from_component_id: "web", to_component_id: "api", authentication: "session", authorization: "member policy" }],
    roles: [{ id: "member", permissions: ["profile:read"] }],
    flows: [{ id: "read-profile", trigger: "member opens profile", outcome: "profile is visible", steps: [{ sequence: 1, component_id: "api", action: "authorize and read", reads: ["user"], writes: [], calls: ["main-db"], evidence_refs: ["system-test"] }] }],
    invariants: [{ id: "own-profile", entity_ids: ["user"], statement: "Members read only authorized profiles.", enforcement: "authorization policy", test_refs: ["security-test"] }],
    risks: [],
    unknowns: [],
    verdict: "complete"
  };
  assert.deepEqual(valid("system-model", model), { valid: true, errors: [] });

  const area = { principles: ["Prefer simple modules and composition."], enforcement: ["architecture review"] };
  const strategy = {
    schema_version: 1,
    id: "strategy-1",
    repository_identity: "example/project",
    commit_sha: sha,
    strategy_version: 1,
    status: "approved",
    artifact_sha256: hash,
    frontend: area,
    backend: area,
    data: area,
    security: area,
    testing: area,
    decisions: [{ id: "modules-first", rule: "Use cohesive module boundaries.", rationale: "Limit change coupling.", applies_to: ["src/**"], source_refs: ["architecture-review"], enforcement: "review" }],
    exceptions: []
  };
  assert.deepEqual(valid("design-strategy", strategy), { valid: true, errors: [] });
  const approval = {
    schema_version: 1,
    id: "approval-1",
    request_id: "approval-request-1",
    request_sha256: hash,
    run_id: "run-1",
    repository_identity: "example/project",
    relevant_head_sha: sha,
    gate: "strategy",
    subject: { id: "strategy-1", artifact_sha256: hash },
    nonce: "nonce-0123456789abcdef",
    decision: "approved",
    decided_at: now,
    decided_by: { id: "developer", kind: "human" },
    source: "interactive-human-gate",
    expires_at: "2026-08-29T13:00:00.000Z",
    attestation: {
      issuer_id: "supervisor-local",
      issuer_fingerprint: hash,
      payload_sha256: hash,
      algorithm: "Ed25519",
      signature: `${"A".repeat(86)}==`
    }
  };
  assert.deepEqual(valid("approval-receipt", approval), { valid: true, errors: [] });
});

test("verification and execution contracts encode proof stages and safe resource claims", () => {
  const stage = (id, level, driver) => ({ id, level, required: true, drivers: [driver], evidence_types: ["test-result"], real_dependencies: level !== "unit", independent: level !== "unit", timeout_ms: 60000, thresholds: [] });
  const policy = {
    schema_version: 1,
    id: "verification-1",
    repository_identity: "example/project",
    policy_version: 1,
    work_type: "feature",
    platforms: ["web"],
    impacts: { database: false, security: true, deployment: false, automation: false },
    modules: [{ id: "profile", changed: true, unit_stage_id: "unit" }],
    stages: [stage("unit", "unit", "node-test"), stage("integration", "integration", "postgres"), stage("functional", "functional", "browser"), stage("system", "system", "browser")],
    release_contract: { deployment: false, migration: false, rollback: false, performance: false, canary: false }
  };
  assert.deepEqual(valid("verification-policy", policy), { valid: true, errors: [] });

  const execution = {
    schema_version: 1,
    id: "execution-1",
    run_id: "run-1",
    head_sha: sha,
    max_parallelism: 2,
    integration_owner_task_id: "integrate",
    progress_interval_seconds: 60,
    nodes: [{ task_id: "integrate", depends_on: [], expected_duration_seconds: 30, resources: [{ kind: "workspace", id: "integration", mode: "exclusive" }, { kind: "external", id: "git:integration-branch", mode: "exclusive" }], workspace_id: "integration", proof_criterion_ids: ["AC-1"], long_running: false }]
  };
  assert.deepEqual(valid("execution-plan", execution), { valid: true, errors: [] });
});

test("new system contracts reject undeclared fields", () => {
  const request = { schema_version: 1, id: "authority-1", repository_identity: "example/project", created_at: now, requests: [], status: "pending", secret_value: "must-not-exist" };
  assert.equal(valid("capability-request", request).valid, false);
});

test("each new contract rejects a representative unsafe boundary", () => {
  assert.equal(valid("repository-understanding-baseline", { schema_version: 1, secret: "x" }).valid, false);
  assert.equal(valid("system-model", { schema_version: 1, id: "model", verdict: "complete" }).valid, false);
  assert.equal(valid("design-strategy", { schema_version: 1, id: "strategy", status: "approved" }).valid, false);
  assert.equal(valid("verification-policy", { schema_version: 1, id: "policy", work_type: "release", stages: [] }).valid, false);
  assert.equal(valid("execution-plan", { schema_version: 1, id: "execution", max_parallelism: 0 }).valid, false);
  assert.equal(valid("onboarding-plan", { schema_version: 1, id: "onboard", mode: "read-only-plan", secret_value: "x" }).valid, false);
});

test("task progress records observable work without private reasoning", () => {
  const progress = {
    schema_version: 1,
    run_id: "run-1",
    task_id: "task-1",
    head_sha: sha,
    status: "running",
    current_step: "Executing integration tests",
    completed_count: 3,
    total_count: 7,
    blockers: [],
    updated_at: now,
    next_update_at: "2026-08-29T12:01:00.000Z"
  };
  assert.deepEqual(valid("task-progress", progress), { valid: true, errors: [] });
  progress.private_reasoning = "not allowed";
  assert.equal(valid("task-progress", progress).valid, false);
});

test("validator enforces combinators, conditions, negation, bounds, and fragments", () => {
  const schemaId = "https://devharness.dev/schemas/v1/validator-feature-probe.schema.json";
  const featureRegistry = new SchemaRegistry([
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: schemaId,
      $defs: {
        shortText: { type: "string", minLength: 1, maxLength: 4 },
        exactChoice: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "value"],
          properties: {
            kind: { enum: ["text", "count"] },
            value: {}
          },
          if: {
            required: ["kind"],
            properties: { kind: { const: "text" } }
          },
          then: {
            properties: { value: { $ref: "#/$defs/shortText" } }
          },
          else: {
            properties: { value: { type: "integer", minimum: 1 } }
          }
        }
      },
      oneOf: [
        { $ref: "#/$defs/exactChoice" },
        {
          type: "object",
          additionalProperties: false,
          maxProperties: 1,
          required: ["cancelled"],
          properties: { cancelled: { const: true } }
        }
      ],
      not: {
        type: "object",
        required: ["secret"],
        properties: { secret: {} }
      }
    }
  ]);

  assert.deepEqual(featureRegistry.validate(`${schemaId}#/$defs/shortText`, "safe"), { valid: true, errors: [] });
  assert.equal(featureRegistry.validate(`${schemaId}#/$defs/shortText`, "oversized").valid, false);
  assert.equal(featureRegistry.validate(schemaId, { kind: "text", value: "safe" }).valid, true);
  assert.equal(featureRegistry.validate(schemaId, { kind: "text", value: "oversized" }).valid, false);
  assert.equal(featureRegistry.validate(schemaId, { kind: "count", value: 2 }).valid, true);
  assert.equal(featureRegistry.validate(schemaId, { kind: "count", value: "2" }).valid, false);
  assert.equal(featureRegistry.validate(schemaId, { cancelled: true }).valid, true);
  assert.equal(featureRegistry.validate(schemaId, { cancelled: true, extra: true }).valid, false);
  assert.equal(featureRegistry.validate(schemaId, { kind: "text", value: "safe", secret: "no" }).valid, false);
});

test("validator requires exactly one oneOf branch and supports anyOf and allOf", () => {
  const schemaId = "https://devharness.dev/schemas/v1/validator-combinator-probe.schema.json";
  const featureRegistry = new SchemaRegistry([
    {
      $id: schemaId,
      $defs: {
        positiveInteger: { type: "integer", minimum: 1 },
        smallNumber: { type: "number", maximum: 10 }
      },
      oneOf: [
        { $ref: "#/$defs/positiveInteger" },
        { $ref: "#/$defs/smallNumber" }
      ]
    },
    {
      $id: `${schemaId.replace(".schema.json", "-composition.schema.json")}`,
      allOf: [
        { type: "string", minLength: 2 },
        { anyOf: [{ pattern: "^ok" }, { pattern: "^safe" }] }
      ]
    }
  ]);

  assert.equal(featureRegistry.validate(schemaId, 3).valid, false, "3 matches both oneOf branches");
  assert.equal(featureRegistry.validate(schemaId, 20).valid, true);
  assert.equal(featureRegistry.validate(schemaId, -1).valid, true);
  const compositionId = schemaId.replace(".schema.json", "-composition.schema.json");
  assert.equal(featureRegistry.validate(compositionId, "okay").valid, true);
  assert.equal(featureRegistry.validate(compositionId, "safe-value").valid, true);
  assert.equal(featureRegistry.validate(compositionId, "bad").valid, false);
});
