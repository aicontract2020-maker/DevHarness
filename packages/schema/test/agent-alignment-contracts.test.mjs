import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SchemaRegistry } from "../src/validator.mjs";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schemas/v1");
const registry = new SchemaRegistry(await Promise.all(
  (await readdir(directory))
    .filter((name) => name.endsWith(".schema.json"))
    .map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")))
));

const ids = {
  common: "https://devharness.dev/schemas/v1/live-alignment-common.schema.json",
  agent: "https://devharness.dev/schemas/v1/agent-runtime.schema.json",
  analysis: "https://devharness.dev/schemas/v1/goal-analysis.schema.json"
};
const hash = "a".repeat(64);
const commit = "b".repeat(40);
const now = "2026-09-01T12:00:00.000Z";
const areas = ["repository-bootstrap", "frontend", "backend", "data", "security", "integration", "testing", "deployment", "automation"];

function validate(schemaId, value) {
  return registry.validate(schemaId, value);
}

function artifact(id, kind = "snapshot") {
  return { id, kind, sha256: hash, media_type: "application/json", size_bytes: 128, storage_key: `artifacts/${id}.json` };
}

const sourceRef = {
  artifact_id: "snapshot-1",
  artifact_sha256: hash,
  location: { kind: "repository", path: "src/app.mjs", line_start: 1, line_end: 3 }
};

function finding(id, kind = "assumption") {
  return { id, kind, summary: `${kind} summary`, material_dimensions: [], source_refs: [sourceRef] };
}

const question = {
  id: "question-1",
  question: "Which behavior should be preserved?",
  options: [
    { id: "preserve", label: "Preserve", outcome: "Keep current behavior.", tradeoffs: ["Less change"], recommended: true },
    { id: "replace", label: "Replace", outcome: "Adopt new behavior.", tradeoffs: ["Migration required"], recommended: false }
  ],
  material_dimensions: ["externally-observable-behavior"],
  source_refs: [sourceRef]
};

const areaAssessments = areas.map((area) => ({ area, proposed_status: "applicable", summary: `${area} is in scope.`, source_refs: [sourceRef] }));
const claim = { id: "claim-1", area: "backend", text: "The backend owns the flow.", proposed_class: "code-confirmed", source_refs: [sourceRef] };
const criterion = { id: "criterion-1", given: "A valid goal", when: "analysis completes", then: "a question is surfaced", proof_surface: "unit", source_refs: [sourceRef] };

const descriptor = {
  schema_version: 1,
  id: "codex",
  version: "1.0.0",
  protocol_version: 1,
  profile_id: "codex-readonly-analysis-v1",
  model_id: "gpt-approved",
  executable_version: "codex-cli-1",
  modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
  features: {
    structured_output: true,
    explicit_cancel: true,
    ephemeral_session: true,
    read_only_tool_policy: true,
    built_in_web_disable: true,
    trusted_usage: true
  },
  implementation_sha256: hash,
  executable_sha256: hash,
  profile_template_sha256: hash,
  control_plane_origins: ["https://api.example.com"],
  descriptor_sha256: hash
};

const limits = {
  attempt_deadline_seconds: 600,
  max_active_execution_seconds: 3600,
  max_result_bytes: 1048576,
  max_stdout_bytes: 10485760,
  max_stderr_bytes: 10485760,
  max_retained_records: 20,
  max_retained_bytes: 20971520,
  max_temporary_bytes: 268435456,
  max_processes: 64,
  max_rss_bytes: 2147483648,
  cleanup_deadline_seconds: 30,
  max_research_queries: 5,
  max_sources_per_query: 5,
  max_research_requests: 25,
  max_redirects_per_request: 3,
  max_research_response_bytes: 2097152,
  max_research_bytes: 10485760,
  research_request_deadline_seconds: 30,
  max_agent_attempts: 6,
  max_provider_requests: 120,
  provider_request_deadline_seconds: 120,
  max_total_tokens: 600000
};

const authority = {
  capability: "agent-runtime",
  subject_id: "agent-runtime-subject-1",
  subject_sha256: hash,
  request_id: "request-1",
  receipt_id: "receipt-1",
  request_sha256: hash,
  receipt_sha256: hash,
  approved_at: now,
  expires_at: "2026-09-01T13:00:00.000Z"
};

const policy = {
  consumer: { read: true, write: false, commit_sha: commit },
  host_read: ["runtime-system-libraries", "adapter-executable", "provider-proxy-client"],
  host_write: ["runtime-attempt-directory"],
  supervisor_access: false,
  consumer_environment: false,
  provider_transport: { approved: true, target_descriptor_sha256: hash, proxy_policy_sha256: hash },
  research_network: { approved: false, authority_ref: null },
  backend: "macos-seatbelt-v1",
  profile_template_sha256: hash,
  profile_instance_sha256: hash
};

const invocation = {
  schema_version: 1,
  id: "agent-invocation-1",
  operation_id: "operation-1",
  attempt_id: "attempt-1",
  attempt_no: 1,
  phase: "analysis-plan",
  execution_instance_id: "execution-1",
  adapter: descriptor,
  input_artifacts: [artifact("goal-1", "goal"), artifact("snapshot-1"), artifact("onboarding-1", "onboarding")],
  authorities: [authority],
  policy,
  profile_instance_sha256: hash,
  remaining_limits: limits,
  result_contract_sha256: hash,
  created_at: now
};

const attempt = {
  schema_version: 1,
  id: "agent-attempt-1",
  operation_id: "operation-1",
  invocation_id: "agent-invocation-1",
  attempt_no: 1,
  phase: "analysis-plan",
  execution_instance_id: "execution-1",
  status: "succeeded",
  started_at: now,
  completed_at: now,
  duration_ms: 100,
  termination_reason: "completed",
  exit_code: 0,
  limit_observations: {
    wall_ms: 100,
    stdout_bytes: 10,
    stderr_bytes: 0,
    result_bytes: 100,
    retained_records: 1,
    retained_bytes: 100,
    temporary_bytes_peak: 1000,
    process_peak: 1,
    rss_bytes_peak: 1000000,
    provider_requests: 1,
    total_tokens: 100
  },
  artifacts: [artifact("analysis-plan-1", "analysis-plan")],
  cleanup: { status: "complete", started_at: now, completed_at: now, duration_ms: 10, remaining_processes: 0, temporary_paths_remaining: 0, proof_sha256: hash },
  isolation_proof_sha256: hash,
  profile_instance_sha256: hash,
  result_sha256: hash,
  usage: { input_tokens: 60, output_tokens: 40, total_tokens: 100 }
};

const analysisPlan = {
  schema_version: 1,
  id: "analysis-plan-1",
  invocation_id: "agent-invocation-1",
  operation_id: "operation-1",
  affected_areas: areaAssessments,
  claims: [claim],
  assumptions: [finding("assumption-1")],
  conflicts: [],
  questions: [question],
  untrusted_instructions: [finding("instruction-1", "untrusted-instruction")],
  research_topics: [{ id: "topic-1", purpose: "Check framework guidance.", public_identifiers: ["framework-v1"], source_refs: [sourceRef] }],
  research_tasks: [{ id: "research-task-1", topic_id: "topic-1", query: "Check framework guidance.", owner: "frontend", priority: 2, approval_capability: "network-research", status: "pending-approval", expected_outcome: "Confirm current framework guidance.", basis: ["framework-v1"] }]
};

const goalAnalysis = {
  schema_version: 1,
  id: "goal-analysis-1",
  invocation_id: "agent-invocation-2",
  operation_id: "operation-1",
  refined_outcome: { id: "outcome-1", text: "Produce a trustworthy alignment brief.", source_refs: [sourceRef] },
  affected_areas: areaAssessments,
  claims: [claim],
  assumptions: [finding("assumption-1")],
  conflicts: [],
  boundaries: [{ id: "boundary-1", text: "Do not modify the consumer.", source_refs: [sourceRef] }],
  non_goals: [{ id: "non-goal-1", text: "No feature implementation.", source_refs: [sourceRef] }],
  questions: [question],
  acceptance_criteria: [criterion],
  untrusted_instructions: [],
  research_source_refs: [],
  research_gaps: []
};

const goalValidation = {
  schema_version: 1,
  id: "goal-analysis-validation-1",
  invocation_id: "agent-invocation-3",
  operation_id: "operation-1",
  producer_analysis_id: "goal-analysis-1",
  citation_checks: [{ id: "citation-check-1", proposal_id: "claim-1", source_ref: sourceRef, exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] }],
  area_checks: areas.map((area) => ({ id: `area-check-${area}`, area, applicable: true, covered: true, conflict: false, source_refs: [sourceRef], finding_ids: [] })),
  question_checks: [{ id: "question-check-1", question_id: "question-1", complete: true, material_dimensions: ["externally-observable-behavior"], source_refs: [sourceRef], finding_ids: [] }],
  missing_items: [],
  prompt_injection_findings: [],
  verdict: "valid"
};

test("shared alignment types reject unsafe paths and ambiguous source locations", () => {
  assert.equal(validate(`${ids.common}#/$defs/artifactRef`, artifact("snapshot-1")).valid, true);
  assert.equal(validate(`${ids.common}#/$defs/sourceRef`, sourceRef).valid, true);
  assert.equal(validate(`${ids.common}#/$defs/artifactRef`, { ...artifact("snapshot-1"), storage_key: "../secret" }).valid, false);
  assert.equal(validate(`${ids.common}#/$defs/sourceLocation`, { ...sourceRef.location, pointer: "/extra" }).valid, false);
});

test("Agent descriptor and invocation are closed, bounded, ordered, and authority-specific", () => {
  assert.equal(validate(ids.agent, descriptor).valid, true);
  assert.equal(validate(`${ids.agent}#/$defs/agentInvocation`, invocation).valid, true);
  assert.equal(validate(ids.agent, { ...descriptor, provider: "openai" }).valid, false);
  assert.equal(validate(ids.agent, { ...descriptor, modes: [...descriptor.modes].reverse() }).valid, false);
  assert.equal(validate(`${ids.agent}#/$defs/agentInvocation`, { ...invocation, authorities: [{ ...authority, capability: "network-research" }] }).valid, false);
  assert.equal(validate(`${ids.agent}#/$defs/agentInvocation`, { ...invocation, policy: { ...policy, consumer: { ...policy.consumer, write: true } } }).valid, false);
});

test("Agent attempt and adapter output reject inconsistent terminal shapes", () => {
  assert.equal(validate(`${ids.agent}#/$defs/agentAttempt`, attempt).valid, true);
  assert.equal(validate(`${ids.agent}#/$defs/agentAttemptOutput`, { status: "succeeded", started_at: now, completed_at: now, exit_code: 0, termination_reason: "completed", result_path: "/private/result.json", usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }, adapter_diagnostics: [] }).valid, true);
  assert.equal(validate(`${ids.agent}#/$defs/agentAttempt`, { ...attempt, status: "failed", termination_reason: "cleanup" }).valid, false);
  assert.equal(validate(`${ids.agent}#/$defs/agentAttemptOutput`, { status: "failed", started_at: now, completed_at: now, exit_code: 1, termination_reason: "provider-error", result_path: null, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, adapter_diagnostics: [] }).valid, false);
});

test("analysis plan accepts evidence proposals but rejects policy and runtime claims", () => {
  assert.equal(validate(`${ids.agent}#/$defs/analysisPlan`, analysisPlan).valid, true);
  const unsafeTopic = { ...analysisPlan, research_topics: [{ ...analysisPlan.research_topics[0], url: "https://example.com" }] };
  assert.equal(validate(`${ids.agent}#/$defs/analysisPlan`, unsafeTopic).valid, false);
  assert.equal(validate(`${ids.agent}#/$defs/analysisPlan`, { ...analysisPlan, claims: [{ ...claim, proposed_class: "runtime-observed" }] }).valid, false);
  assert.equal(validate(`${ids.agent}#/$defs/analysisPlan`, { ...analysisPlan, affected_areas: areaAssessments.slice(0, 8) }).valid, false);
});

test("synthesis and fresh validation records cannot assign authority or readiness", () => {
  assert.equal(validate(ids.analysis, goalAnalysis).valid, true);
  assert.equal(validate(`${ids.analysis}#/$defs/goalAnalysisValidation`, goalValidation).valid, true);
  assert.equal(validate(ids.analysis, { ...goalAnalysis, ready: true }).valid, false);
  assert.equal(validate(`${ids.analysis}#/$defs/goalAnalysisValidation`, { ...goalValidation, readiness: "ready" }).valid, false);
  assert.equal(validate(`${ids.analysis}#/$defs/goalAnalysisValidation`, { ...goalValidation, verdict: "approved" }).valid, false);
});
