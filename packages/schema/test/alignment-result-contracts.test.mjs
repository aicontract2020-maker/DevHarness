import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SchemaRegistry } from "../src/validator.mjs";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schemas/v1");
const registry = new SchemaRegistry(await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".schema.json")).map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")))));
const ids = {
  research: "https://devharness.dev/schemas/v1/research-records.schema.json",
  answer: "https://devharness.dev/schemas/v1/developer-answer.schema.json",
  bundle: "https://devharness.dev/schemas/v1/alignment-bundle.schema.json"
};
const hash = "a".repeat(64);
const commit = "b".repeat(40);
const now = "2026-09-01T12:00:00.000Z";
const artifact = (id, kind) => ({ id, kind, sha256: hash, media_type: "application/json", size_bytes: 100, storage_key: `artifacts/${id}.json` });
const sourceRef = { artifact_id: "snapshot-1", artifact_sha256: hash, location: { kind: "repository", path: "src/app.mjs", line_start: 1, line_end: 2 } };
const authority = (capability = "network-research") => ({ capability, subject_id: "subject-1", subject_sha256: hash, request_id: "request-1", receipt_id: "receipt-1", request_sha256: hash, receipt_sha256: hash, approved_at: now, expires_at: "2026-09-01T13:00:00.000Z" });
const recipe = { id: "recipe-1", adapter: "exact-https-get-v1", url: "https://docs.example.com/search?q=framework", origin_id: "origin-1", method: "GET", header_profile: "public-text-v1", body: null, deadline_seconds: 30, max_response_bytes: 2097152, recipe_sha256: hash };
const query = { schema_version: 1, id: "research-query-1", operation_id: "operation-1", purpose: "Review public framework guidance.", query: "framework security guidance", origin_ids: ["origin-1"], constructed_from: [sourceRef], requests: [recipe], max_sources: 5, query_sha256: hash };
const source = { schema_version: 1, id: "research-source-1", operation_id: "operation-1", run_id: "run-1", repository_identity: "example/project", commit_sha: commit, query_id: "research-query-1", network_authority_ref: authority(), approved_origin: "https://docs.example.com", authority_epoch: 1, reservation_id: "reservation-1", reservation_sha256: hash, request_receipt_id: "outbound-receipt-1", request_receipt_sha256: hash, final_url: "https://docs.example.com/result", title: "Framework guidance", retrieved_at: now, content_sha256: hash, excerpt: "Sanitized public guidance.", excerpt_sha256: hash, research_payload_sha256: hash, untrusted: true };
const researchReservation = { schema_version: 1, id: "reservation-1", operation_id: "operation-1", channel: "research", ordinal: 1, attempt_id: null, query_id: "research-query-1", authority_capability: "network-research", authority_receipt_sha256: hash, authority_epoch: 1, request_sha256: hash, recipe_sha256: hash, reserved_input_tokens: 0, reserved_output_tokens: 0, reserved_tokens: 0, reserved_response_bytes: 2097152, reserved_active_ms: 30000, reserved_at: now };
const providerReservation = { ...researchReservation, id: "reservation-2", channel: "provider", attempt_id: "attempt-1", query_id: null, authority_capability: "agent-runtime", authority_epoch: 0, recipe_sha256: null, reserved_input_tokens: 100, reserved_output_tokens: 200, reserved_tokens: 300, reserved_response_bytes: 0, reserved_active_ms: 0 };
const researchReceipt = { schema_version: 1, id: "outbound-receipt-1", reservation_id: "reservation-1", reservation_sha256: hash, status: "completed", completed_at: now, response_status: 200, response_bytes: 1000, active_ms: 100, response_sha256: hash, final_url: "https://docs.example.com/result", research_payload_sha256: hash, usage: null, diagnostic_code: null };
const answer = { schema_version: 1, id: "developer-answer-1", run_id: "run-1", repository_identity: "example/project", commit_sha: commit, packet_sha256: hash, decision_id: "decision-1", option_id: "option-1", decision_ref: { gate: "alignment-answer", subject_sha256: hash, request_id: "answer-request-1", receipt_id: "answer-receipt-1", request_sha256: hash, receipt_sha256: hash, actor: { id: "developer", kind: "human" }, decided_at: now }, actor: { id: "developer", kind: "human" }, answered_at: now };
const descriptor = { schema_version: 1, id: "codex", version: "1.0.0", protocol_version: 1, profile_id: "codex-readonly-analysis-v1", model_id: "gpt-approved", executable_version: "codex-1", modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"], features: { structured_output: true, explicit_cancel: true, ephemeral_session: true, read_only_tool_policy: true, built_in_web_disable: true, trusted_usage: true }, implementation_sha256: hash, executable_sha256: hash, profile_template_sha256: hash, control_plane_origins: ["https://api.example.com"], descriptor_sha256: hash };
const areas = ["repository-bootstrap", "frontend", "backend", "data", "security", "integration", "testing", "deployment", "automation"];
const review = (id, text) => ({ id, text, source_refs: [sourceRef] });
const option = (id, recommended) => ({ id, label: id, outcome: `${id} outcome`, tradeoffs: ["One tradeoff"], recommended });
const bundle = {
  schema_version: 1, id: "alignment-bundle-1", operation_id: "operation-1", run_id: "run-1", repository_identity: "example/project", commit_sha: commit,
  goal_ref: artifact("goal-1", "goal"), developer_answer_refs: [artifact("developer-answer-1", "developer-answer")], agent_descriptor: descriptor,
  analysis_plan_ref: artifact("analysis-plan-1", "analysis-plan"), research_source_refs: [artifact("research-source-1", "research-source")], research_gaps: [],
  goal_analysis_ref: artifact("goal-analysis-1", "goal-analysis"), validation_ref: artifact("validation-1", "analysis-validation"),
  refined_outcome: review("outcome-1", "Deliver a trustworthy Alignment Brief."), boundaries: [review("boundary-1", "Do not modify the consumer.")],
  area_decisions: areas.map((area) => ({ id: `area-${area}`, area, status: "applicable", summary: `${area} is covered.`, claim_ids: ["claim-1"], source_refs: [sourceRef] })),
  classified_claims: [{ id: "claim-1", area: "backend", text: "The backend owns the flow.", status: "code-confirmed", source_refs: [sourceRef], validator_check_ids: ["check-1"] }],
  assumptions: [], conflicts: [], non_goals: [review("non-goal-1", "No implementation in this slice.")],
  material_decisions: [{ id: "decision-1", question: "Which behavior?", why_now: "Observable behavior changes.", impact: "medium", reversibility: "reversible", recommended_option_id: "option-1", options: [option("option-1", true), option("option-2", false)], material_dimensions: ["externally-observable-behavior"], source_refs: [sourceRef] }],
  acceptance_criteria: [{ id: "criterion-1", given: "A goal", when: "analysis completes", then: "a brief is shown", proof_surface: "unit", source_refs: [sourceRef] }],
  traceability: [{ item_id: "outcome-1", item_kind: "section-item", source_refs: [sourceRef] }], blocking_ids: ["decision-1"], omitted_count: 0, verdict: "question-blocked", policy_version_sha256: hash
};

test("research requests are exact, bounded, and incapable of carrying credentials or bodies", () => {
  assert.equal(registry.validate(ids.research, query).valid, true);
  assert.equal(registry.validate(ids.research, { ...query, requests: [{ ...recipe, url: "https://user:secret@docs.example.com/result" }] }).valid, false);
  assert.equal(registry.validate(ids.research, { ...query, requests: [{ ...recipe, body: "repository data" }] }).valid, false);
  assert.equal(registry.validate(ids.research, { ...query, policy: "allow all" }).valid, false);
});

test("research sources remain untrusted and bind the approved authority epoch", () => {
  assert.equal(registry.validate(`${ids.research}#/$defs/researchSource`, source).valid, true);
  assert.equal(registry.validate(`${ids.research}#/$defs/researchSource`, { ...source, untrusted: false }).valid, false);
  assert.equal(registry.validate(`${ids.research}#/$defs/researchSource`, { ...source, network_authority_ref: authority("agent-runtime") }).valid, false);
  assert.equal(registry.validate(`${ids.research}#/$defs/researchSource`, { ...source, authority_epoch: 0 }).valid, false);
});

test("provider and research reservations and receipts have mutually exclusive shapes", () => {
  assert.equal(registry.validate(`${ids.research}#/$defs/outboundRequestReservation`, researchReservation).valid, true);
  assert.equal(registry.validate(`${ids.research}#/$defs/outboundRequestReservation`, providerReservation).valid, true);
  assert.equal(registry.validate(`${ids.research}#/$defs/outboundRequestReservation`, { ...researchReservation, reserved_output_tokens: 1 }).valid, false);
  assert.equal(registry.validate(`${ids.research}#/$defs/outboundRequestReceipt`, researchReceipt).valid, true);
  assert.equal(registry.validate(`${ids.research}#/$defs/outboundRequestReceipt`, { ...researchReceipt, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }).valid, false);
});

test("research terminal manifests distinguish success from failure", () => {
  const success = { schema_version: 1, id: "manifest-1", operation_id: "operation-1", reservation_id: "reservation-1", reservation_sha256: hash, outcome: "success", receipt_sha256: hash, source_sha256: hash, gap_sha256: null, research_payload_sha256: hash, created_at: now };
  const failure = { ...success, id: "manifest-2", outcome: "failure", source_sha256: null, gap_sha256: hash, research_payload_sha256: null };
  assert.equal(registry.validate(`${ids.research}#/$defs/researchResultManifest`, success).valid, true);
  assert.equal(registry.validate(`${ids.research}#/$defs/researchResultManifest`, failure).valid, true);
  assert.equal(registry.validate(`${ids.research}#/$defs/researchResultManifest`, { ...success, gap_sha256: hash }).valid, false);
});

test("developer answers require a closed Supervisor-verified human decision", () => {
  assert.equal(registry.validate(ids.answer, answer).valid, true);
  assert.equal(registry.validate(ids.answer, { ...answer, actor: { id: "codex", kind: "agent" } }).valid, false);
  assert.equal(registry.validate(ids.answer, { ...answer, free_text: "silently inferred" }).valid, false);
});

test("Alignment Bundle is closed, traceable, and cannot contain Agent authority or self-readiness", () => {
  assert.equal(registry.validate(ids.bundle, bundle).valid, true);
  assert.equal(registry.validate(ids.bundle, { ...bundle, authority: "agent-approved" }).valid, false);
  assert.equal(registry.validate(ids.bundle, { ...bundle, verdict: "agent-ready" }).valid, false);
  assert.equal(registry.validate(ids.bundle, { ...bundle, area_decisions: bundle.area_decisions.slice(0, 8) }).valid, false);
});
