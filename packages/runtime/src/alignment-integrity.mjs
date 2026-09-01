import { isDeepStrictEqual } from "node:util";

import { canonicalDigest, canonicalRecordId } from "./canonical-records.mjs";

const SAFE_STORAGE_KEY = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^\\\0]+$/;

function fail(message) {
  throw new Error(`Alignment integrity failure: ${message}`);
}

function assertEqual(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) fail(`${label} mismatch.`);
}

function assertStorageKeys(value, ancestors = new Set()) {
  if (value === null || typeof value !== "object" || ancestors.has(value)) return;
  ancestors.add(value);
  if (!Array.isArray(value) && Object.hasOwn(value, "storage_key")) {
    if (typeof value.storage_key !== "string" || !SAFE_STORAGE_KEY.test(value.storage_key)) fail("unsafe storage key.");
  }
  for (const child of Object.values(value)) assertStorageKeys(child, ancestors);
  ancestors.delete(value);
}

function assertCanonicalId(type, record, excluded = ["id"]) {
  assertEqual(record.id, canonicalRecordId(type, record, excluded), `${type} id/digest`);
}

function assertDescriptor(descriptor) {
  assertEqual(descriptor.descriptor_sha256, canonicalDigest("agent-descriptor", descriptor, ["descriptor_sha256"]), "Agent descriptor digest");
}

function assertInvocationJoins(operation, invocations, attempts) {
  const byId = new Map(invocations.map((invocation) => [invocation.id, invocation]));
  const producer = invocations.find(({ phase }) => phase === "analysis-synthesis");
  const validator = invocations.find(({ phase }) => phase === "analysis-validation");
  if (producer && validator && producer.execution_instance_id === validator.execution_instance_id) {
    fail("validator execution instance must differ from the producer.");
  }

  for (const invocation of invocations) {
    assertEqual(invocation.operation_id, operation.id, "invocation operation");
    assertEqual(invocation.adapter, operation.agent_descriptor, "invocation Agent descriptor");
    const agentAuthority = invocation.authorities?.find(({ capability }) => capability === "agent-runtime");
    if (!agentAuthority || agentAuthority.subject_id !== operation.agent_authority_subject.id || agentAuthority.subject_sha256 !== operation.agent_authority_subject.sha256) {
      fail("Agent authority does not bind the operation subject.");
    }
  }

  for (const attempt of attempts) {
    const invocation = byId.get(attempt.invocation_id);
    if (!invocation) fail("attempt references an unknown invocation.");
    assertEqual(attempt.operation_id, operation.id, "attempt operation");
    assertEqual(attempt.phase, invocation.phase, "attempt phase");
    assertEqual(attempt.execution_instance_id, invocation.execution_instance_id, "attempt execution instance");
    assertEqual(attempt.profile_instance_sha256, invocation.profile_instance_sha256, "attempt execution profile digest");
  }
  const producerAttempt = attempts.find(({ invocation_id: id }) => id === producer?.id);
  const validatorAttempt = attempts.find(({ invocation_id: id }) => id === validator?.id);
  if (producerAttempt && validatorAttempt && producerAttempt.isolation_proof_sha256 === validatorAttempt.isolation_proof_sha256) {
    fail("validator isolation proof must differ from the producer.");
  }
}

function assertResearchJoins(operation, transaction) {
  const { query, authority, reservation, receipt, source, manifest } = transaction;
  assertEqual(query.operation_id, operation.id, "research query operation");
  for (const recipe of query.requests ?? []) {
    assertEqual(recipe.recipe_sha256, canonicalDigest("research-request-recipe", recipe, ["recipe_sha256"]), "research recipe digest");
  }
  assertEqual(query.query_sha256, canonicalDigest("research-query", query, ["id", "query_sha256"]), "research query digest");
  assertEqual(reservation.operation_id, operation.id, "research reservation operation");
  assertEqual(reservation.query_id, query.id, "research reservation query");
  if (!query.requests?.some(({ recipe_sha256: digest }) => digest === reservation.recipe_sha256)) fail("research reservation recipe digest mismatch.");
  if (authority.capability !== "network-research" || reservation.authority_capability !== "network-research" || reservation.authority_receipt_sha256 !== authority.receipt_sha256) {
    fail("research authority mismatch.");
  }
  const reservationSha = canonicalDigest("outbound-request-reservation", reservation);
  assertEqual(receipt.reservation_id, reservation.id, "outbound receipt reservation");
  assertEqual(receipt.reservation_sha256, reservationSha, "outbound receipt reservation digest");

  assertEqual(source.operation_id, operation.id, "research source operation");
  assertEqual(source.run_id, operation.run_id, "research source run");
  assertEqual(source.repository_identity, operation.repository_identity, "research source repository");
  assertEqual(source.commit_sha, operation.commit_sha, "research source revision");
  assertEqual(source.query_id, query.id, "research source query");
  assertEqual(source.network_authority_ref, authority, "research source authority");
  assertEqual(source.authority_epoch, reservation.authority_epoch, "research source authority epoch");
  assertEqual(source.reservation_id, reservation.id, "research source reservation");
  assertEqual(source.reservation_sha256, reservationSha, "research source reservation digest");
  const receiptSha = canonicalDigest("outbound-request-receipt", receipt);
  assertEqual(source.request_receipt_id, receipt.id, "research source receipt");
  assertEqual(source.request_receipt_sha256, receiptSha, "research source receipt digest");
  assertEqual(source.research_payload_sha256, receipt.research_payload_sha256, "research payload digest");
  if (source.untrusted !== true) fail("research source must remain untrusted.");

  assertEqual(manifest.operation_id, operation.id, "research manifest operation");
  assertEqual(manifest.reservation_id, reservation.id, "research manifest reservation");
  assertEqual(manifest.reservation_sha256, reservationSha, "research manifest reservation digest");
  assertEqual(manifest.receipt_sha256, receiptSha, "research manifest receipt digest");
  assertEqual(manifest.source_sha256, canonicalDigest("research-source", source), "research manifest source digest");
  assertEqual(manifest.research_payload_sha256, source.research_payload_sha256, "research manifest payload digest");
}

export function assertAlignmentIntegrity(records) {
  if (!records || typeof records !== "object" || Array.isArray(records)) fail("record set is missing.");
  const { operation, bundle, invocations = [], attempts = [], research = [] } = records;
  if (!operation || !bundle) fail("operation and Alignment Bundle are required.");

  assertStorageKeys(records);
  assertEqual(bundle.operation_id, operation.id, "Alignment Bundle operation");
  assertEqual(bundle.run_id, operation.run_id, "Alignment Bundle run");
  assertEqual(bundle.repository_identity, operation.repository_identity, "Alignment Bundle repository");
  assertEqual(bundle.commit_sha, operation.commit_sha, "Alignment Bundle revision");
  assertEqual(bundle.agent_descriptor, operation.agent_descriptor, "Alignment Bundle Agent descriptor");
  assertDescriptor(operation.agent_descriptor);
  assertInvocationJoins(operation, invocations, attempts);
  for (const transaction of research) assertResearchJoins(operation, transaction);

  const sourceById = new Map(research.map(({ source }) => [source.id, source]));
  for (const reference of bundle.research_source_refs ?? []) {
    const source = sourceById.get(reference.id);
    if (!source) fail("Alignment Bundle references an unknown research source.");
    assertEqual(reference.sha256, canonicalDigest("research-source", source), "Alignment Bundle research source digest");
  }

  assertCanonicalId("alignment-operation", operation);
  for (const invocation of invocations) assertCanonicalId("agent-invocation", invocation, ["id", "created_at"]);
  for (const attempt of attempts) assertCanonicalId("agent-attempt", attempt);
  for (const { query, reservation, receipt, source, manifest } of research) {
    assertCanonicalId("research-query", query, ["id", "query_sha256"]);
    assertCanonicalId("outbound-request-reservation", reservation);
    assertCanonicalId("outbound-request-receipt", receipt);
    assertCanonicalId("research-source", source);
    assertCanonicalId("research-result-manifest", manifest);
  }
  assertCanonicalId("alignment-bundle", bundle);
  return true;
}
