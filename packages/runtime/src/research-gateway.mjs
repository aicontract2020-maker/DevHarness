import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

import { canonicalDigest, canonicalJson, canonicalRecordId } from "./canonical-records.mjs";
import {
  buildResearchQueryText,
  createResearchOriginCandidate,
  createResearchRequestRecipe,
  createNetworkResearchSubject,
  isOutboundResearchQuerySafe,
  normalizeExactHttpsUrl,
  validateResearchRedirect
} from "./research-policy.mjs";
import { projectDataDirectory } from "./data-store.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const MAX_EXCERPT_BYTES = 8192;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function requireIdentifier(value, label) {
  if (!IDENTIFIER.test(value ?? "")) throw new Error(`Invalid ${label}.`);
}

function requireSha(value, label) {
  if (!SHA256.test(value ?? "")) throw new Error(`Invalid ${label}.`);
}

function researchRoot(dataRoot, repositoryIdentity, operationId) {
  return path.join(projectDataDirectory(dataRoot, repositoryIdentity), "operations", operationId, "outbound", "research");
}

export function researchGatewayPaths(dataRoot, repositoryIdentity, operationId, ordinal) {
  requireIdentifier(operationId, "operation id");
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 25) throw new Error("Invalid research ordinal.");
  const root = path.join(researchRoot(dataRoot, repositoryIdentity, operationId), String(ordinal));
  return {
    root,
    terminal: path.join(root, "terminal"),
    stagingRoot: path.join(researchRoot(dataRoot, repositoryIdentity, operationId), `.creating-${String(ordinal).padStart(2, "0")}-${process.pid}-${randomUUID()}`)
  };
}

async function ensureDirectory(target, { create = false } = {}) {
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe runtime directory: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT" || !create) throw error;
    await mkdir(target, { recursive: true, mode: 0o700 });
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe runtime directory: ${target}`);
  }
}

async function syncDirectory(target) {
  const handle = await open(target, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await syncDirectory(path.dirname(target));
}

async function readJson(target) {
  const handle = await open(target, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Research terminal artifact is not a file.");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

function trimExcerpt(text) {
  const sanitized = String(text ?? "").replace(CONTROL_CHARS, "");
  return sanitized.length <= MAX_EXCERPT_BYTES ? sanitized : sanitized.slice(0, MAX_EXCERPT_BYTES);
}

function sha256Text(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function identify(type, record, excludedFields = ["id"]) {
  const draft = { ...record, id: "pending" };
  draft.id = canonicalRecordId(type, draft, excludedFields);
  return draft;
}

function sourceRefFromQuery(query) {
  return {
    artifact_id: query.id,
    artifact_sha256: query.query_sha256,
    location: { kind: "json", pointer: "/queries/0" }
  };
}

function sourceRefFromRecipe(recipe) {
  return {
    artifact_id: recipe.id,
    artifact_sha256: recipe.recipe_sha256,
    location: { kind: "json", pointer: "/requests/0" }
  };
}

async function loadTerminal(paths) {
  try {
    await ensureDirectory(paths.terminal);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ENOTDIR") return null;
    if (error.message?.includes("Unsafe runtime directory")) throw error;
  }
  let manifest;
  try {
    manifest = await readJson(path.join(paths.terminal, "manifest.json"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const receipt = await readJson(path.join(paths.terminal, "receipt.json"));
  const sourcePath = path.join(paths.terminal, "source.json");
  const gapPath = path.join(paths.terminal, "gap.json");
  let source = null;
  let gap = null;
  try {
    source = await readJson(sourcePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    gap = await readJson(gapPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if ((manifest.outcome === "success" && !source) || (manifest.outcome === "failure" && !gap)) {
    throw new Error("Research terminal is incomplete.");
  }
  return { manifest, receipt, source, gap, paths };
}

function buildReservation({ operationId, queryId, ordinal, authority, authorityEpoch, requestRecipe, requestSha256, maxResponseBytes, deadlineSeconds, now }) {
  const reservedAt = now().toISOString();
  const reservation = {
    schema_version: 1,
    id: "pending",
    operation_id: operationId,
    channel: "research",
    ordinal,
    attempt_id: null,
    query_id: queryId,
    authority_capability: "network-research",
    authority_receipt_sha256: authority.receipt_sha256,
    authority_epoch: authorityEpoch,
    request_sha256: requestSha256,
    recipe_sha256: requestRecipe.recipe_sha256,
    reserved_input_tokens: 0,
    reserved_output_tokens: 0,
    reserved_tokens: 0,
    reserved_response_bytes: maxResponseBytes,
    reserved_active_ms: deadlineSeconds * 1000,
    reserved_at: reservedAt
  };
  reservation.id = canonicalRecordId("outbound-request-reservation", reservation);
  reservation.reservation_sha256 = canonicalDigest("outbound-request-reservation", reservation, ["id", "reservation_sha256"]);
  reservation.id = canonicalRecordId("outbound-request-reservation", reservation);
  return reservation;
}

function buildReceipt({ reservation, status, responseStatus, responseBytes, responseSha256, finalUrl, researchPayloadSha256, usage, diagnosticCode, now, activeMs }) {
  const completedAt = now().toISOString();
  const receipt = {
    schema_version: 1,
    id: "pending",
    reservation_id: reservation.id,
    reservation_sha256: reservation.reservation_sha256,
    status,
    completed_at: completedAt,
    response_status: responseStatus,
    response_bytes: responseBytes,
    active_ms: activeMs,
    response_sha256: responseSha256,
    final_url: finalUrl,
    research_payload_sha256: researchPayloadSha256,
    usage,
    diagnostic_code: diagnosticCode
  };
  receipt.id = canonicalRecordId("outbound-request-receipt", receipt);
  receipt.receipt_sha256 = canonicalDigest("outbound-request-receipt", receipt, ["id", "receipt_sha256"]);
  receipt.id = canonicalRecordId("outbound-request-receipt", receipt);
  return receipt;
}

function buildSuccessSource({ repositoryIdentity, runId, commitSha, queryId, authority, authorityEpoch, reservation, receipt, finalUrl, title, content, excerpt, now }) {
  const contentSha256 = sha256Text(content);
  const excerptSha256 = sha256Text(excerpt);
  const source = {
    schema_version: 1,
    id: "pending",
    operation_id: reservation.operation_id,
    run_id: runId,
    repository_identity: repositoryIdentity,
    commit_sha: commitSha,
    query_id: queryId,
    network_authority_ref: authority,
    approved_origin: new URL(finalUrl).origin,
    authority_epoch: authorityEpoch,
    reservation_id: reservation.id,
    reservation_sha256: reservation.reservation_sha256,
    request_receipt_id: receipt.id,
    request_receipt_sha256: receipt.receipt_sha256,
    final_url: finalUrl,
    title,
    retrieved_at: now().toISOString(),
    content_sha256: contentSha256,
    excerpt,
    excerpt_sha256: excerptSha256,
    research_payload_sha256: canonicalDigest("research-payload", { final_url: finalUrl, title, content_sha256: contentSha256, excerpt_sha256: excerptSha256 }),
    untrusted: true
  };
  source.id = canonicalRecordId("research-source", source);
  return source;
}

function buildGap({ queryId, reservation, reason, summary, sourceRefs }) {
  const gap = {
    id: "pending",
    query_id: queryId,
    reason,
    summary,
    source_refs: sourceRefs
  };
  gap.id = canonicalRecordId("research-gap", gap);
  return gap;
}

function buildManifest({ reservation, receipt, sourceSha256 = null, gapSha256 = null, researchPayloadSha256 = null, outcome }) {
  const manifest = {
    schema_version: 1,
    id: "pending",
    operation_id: reservation.operation_id,
    reservation_id: reservation.id,
    reservation_sha256: reservation.reservation_sha256,
    outcome,
    receipt_sha256: receipt.receipt_sha256,
    source_sha256: sourceSha256,
    gap_sha256: gapSha256,
    research_payload_sha256: researchPayloadSha256,
    created_at: receipt.completed_at
  };
  manifest.id = canonicalRecordId("research-result-manifest", manifest);
  return manifest;
}

async function writeTerminalAtomic(paths, records) {
  await mkdir(paths.stagingRoot, { recursive: true, mode: 0o700 });
  try {
    await mkdir(paths.terminal, { recursive: true, mode: 0o700 });
    const root = path.join(paths.stagingRoot, "terminal");
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeJson(path.join(root, "manifest.json"), records.manifest);
    await writeJson(path.join(root, "receipt.json"), records.receipt);
    if (records.source) await writeJson(path.join(root, "source.json"), records.source);
    if (records.gap) await writeJson(path.join(root, "gap.json"), records.gap);
    await rename(root, paths.terminal);
    await syncDirectory(path.dirname(paths.terminal));
  } catch (error) {
    await rm(paths.stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function responseSummary(error, fallback = "Request failed.") {
  if (error?.message) return error.message.slice(0, 1000);
  return fallback;
}

export function createResearchGatewayContext({
  operationId,
  queryId,
  recipeSha256,
  authorityEpoch,
  authority,
  subjectSha256,
  remainingRequests,
  remainingBytes
} = {}) {
  requireIdentifier(operationId, "operation id");
  requireIdentifier(queryId, "query id");
  requireSha(recipeSha256, "recipe digest");
  requireSha(subjectSha256, "subject digest");
  if (!Number.isInteger(authorityEpoch) || authorityEpoch < 1 || authorityEpoch > 20) throw new Error("Invalid research authority epoch.");
  if (!Number.isInteger(remainingRequests) || remainingRequests < 1 || remainingRequests > 25) throw new Error("Invalid remaining requests.");
  if (!Number.isInteger(remainingBytes) || remainingBytes < 1 || remainingBytes > 10_485_760) throw new Error("Invalid remaining bytes.");
  if (!authority || authority.capability !== "network-research") throw new Error("Research authority is invalid.");
  return Object.freeze({
    schema_version: 1,
    operation_id: operationId,
    query_id: queryId,
    recipe_sha256: recipeSha256,
    authority_epoch: authorityEpoch,
    authority: structuredClone(authority),
    subject_sha256: subjectSha256,
    remaining_requests: remainingRequests,
    remaining_bytes: remainingBytes
  });
}

export async function runControlledResearchGateway({
  dataRoot,
  repositoryIdentity,
  runId,
  commitSha,
  operationId,
  queryId,
  query,
  subject,
  authority,
  authorityEpoch,
  requestRecipe,
  ordinal = 1,
  fetchImpl = fetch,
  publishReservation = async () => {},
  publishReceipt = async () => {},
  now = () => new Date()
} = {}) {
  requireIdentifier(runId, "run id");
  requireIdentifier(operationId, "operation id");
  requireIdentifier(queryId, "query id");
  if (typeof repositoryIdentity !== "string" || repositoryIdentity.length < 1 || repositoryIdentity.length > 2048) throw new Error("Invalid repository identity.");
  if (!/^[0-9a-f]{40}$/.test(commitSha ?? "")) throw new Error("Invalid commit sha.");
  if (!subject || subject.operation_id !== operationId || subject.query_set_sha256 == null) throw new Error("Research subject is invalid.");
  if (!authority || authority.capability !== "network-research") throw new Error("Research authority is invalid.");
  if (authority.subject_sha256 !== subject.subject_sha256) throw new Error("Research authority subject is not current.");
  if (!Number.isInteger(authorityEpoch) || authorityEpoch < 1 || authorityEpoch > 20) throw new Error("Invalid authority epoch.");
  if (!isOutboundResearchQuerySafe(query) || query.length > 512) throw new Error("Research query contains secret or invalid content.");
  const paths = researchGatewayPaths(dataRoot, repositoryIdentity, operationId, ordinal);
  const existing = await loadTerminal(paths);
  if (existing) return { created: false, paths, ...existing };

  const exactUrl = normalizeExactHttpsUrl(requestRecipe.url, [new URL(requestRecipe.url).origin]);
  const requestSha256 = canonicalDigest("research-request", {
    schema_version: 1,
    operation_id: operationId,
    query_id: queryId,
    query,
    request: requestRecipe,
    authority_epoch: authorityEpoch,
    subject_sha256: subject.subject_sha256
  });
  const reservation = buildReservation({
    operationId,
    queryId,
    ordinal,
    authority,
    authorityEpoch,
    requestRecipe,
    requestSha256,
    maxResponseBytes: requestRecipe.max_response_bytes,
    deadlineSeconds: requestRecipe.deadline_seconds,
    now
  });
  await publishReservation(reservation);

  const startedAt = now();
  try {
    const response = await fetchImpl(exactUrl, { method: "GET", redirect: "manual" });
    const location = response.headers?.get?.("location");
    if (response.status >= 300 && response.status < 400 && location) {
      let redirected;
      try {
        redirected = validateResearchRedirect({ fromUrl: exactUrl, location, allowedOrigins: [new URL(exactUrl).origin] });
      } catch (error) {
        const receipt = buildReceipt({
          reservation,
          status: "failed",
          responseStatus: response.status,
          responseBytes: 0,
          responseSha256: null,
          finalUrl: null,
          researchPayloadSha256: null,
          usage: null,
          diagnosticCode: "ORIGIN_NOT_ALLOWED",
          now,
          activeMs: Math.max(0, now().getTime() - startedAt.getTime())
        });
        await publishReceipt(receipt);
        const gap = buildGap({
          queryId,
          reservation,
          reason: "denied",
          summary: "Redirect leaves the approved origin set.",
          sourceRefs: [sourceRefFromQuery({ id: queryId, query_sha256: subject.query_set_sha256 }), sourceRefFromRecipe(requestRecipe)]
        });
        const manifest = buildManifest({ reservation, receipt, gapSha256: canonicalDigest("research-gap", gap), outcome: "failure" });
        await writeTerminalAtomic(paths, { manifest, receipt, source: null, gap });
        return { created: true, paths, reservation, receipt, source: null, gap, manifest };
      }
      const receipt = buildReceipt({
        reservation,
        status: "failed",
        responseStatus: response.status,
        responseBytes: 0,
        responseSha256: null,
        finalUrl: redirected,
        researchPayloadSha256: null,
        usage: null,
        diagnosticCode: "ORIGIN_NOT_ALLOWED",
        now,
        activeMs: Math.max(0, now().getTime() - startedAt.getTime())
      });
      await publishReceipt(receipt);
      const gap = buildGap({
        queryId,
        reservation,
        reason: "denied",
        summary: `Redirect to ${redirected} left the approved origin set.`,
        sourceRefs: [sourceRefFromQuery({ id: queryId, query_sha256: subject.query_set_sha256 }), sourceRefFromRecipe(requestRecipe)]
      });
      const manifest = buildManifest({ reservation, receipt, gapSha256: canonicalDigest("research-gap", gap), outcome: "failure" });
      await writeTerminalAtomic(paths, { manifest, receipt, source: null, gap });
      return { created: true, paths, reservation, receipt, source: null, gap, manifest };
    }

    if (!response.ok) {
      const body = await response.text();
      const receipt = buildReceipt({
        reservation,
        status: "failed",
        responseStatus: response.status,
        responseBytes: Buffer.byteLength(body, "utf8"),
        responseSha256: sha256Text(body),
        finalUrl: exactUrl,
        researchPayloadSha256: null,
        usage: null,
        diagnosticCode: "UNAVAILABLE",
        now,
        activeMs: Math.max(0, now().getTime() - startedAt.getTime())
      });
      await publishReceipt(receipt);
      const gap = buildGap({
        queryId,
        reservation,
        reason: "unavailable",
        summary: `Upstream returned HTTP ${response.status}.`,
        sourceRefs: [sourceRefFromQuery({ id: queryId, query_sha256: subject.query_set_sha256 }), sourceRefFromRecipe(requestRecipe)]
      });
      const manifest = buildManifest({ reservation, receipt, gapSha256: canonicalDigest("research-gap", gap), outcome: "failure" });
      await writeTerminalAtomic(paths, { manifest, receipt, source: null, gap });
      return { created: true, paths, reservation, receipt, source: null, gap, manifest };
    }

    const raw = await response.text();
    const responseBytes = Buffer.byteLength(raw, "utf8");
    if (responseBytes > requestRecipe.max_response_bytes) {
      const receipt = buildReceipt({
        reservation,
        status: "failed",
        responseStatus: response.status,
        responseBytes,
        responseSha256: sha256Text(raw),
        finalUrl: exactUrl,
        researchPayloadSha256: null,
        usage: null,
        diagnosticCode: "RESEARCH_LIMIT",
        now,
        activeMs: Math.max(0, now().getTime() - startedAt.getTime())
      });
      await publishReceipt(receipt);
      const gap = buildGap({
        queryId,
        reservation,
        reason: "limit",
        summary: `Response exceeded the ${requestRecipe.max_response_bytes} byte ceiling.`,
        sourceRefs: [sourceRefFromQuery({ id: queryId, query_sha256: subject.query_set_sha256 }), sourceRefFromRecipe(requestRecipe)]
      });
      const manifest = buildManifest({ reservation, receipt, gapSha256: canonicalDigest("research-gap", gap), outcome: "failure" });
      await writeTerminalAtomic(paths, { manifest, receipt, source: null, gap });
      return { created: true, paths, reservation, receipt, source: null, gap, manifest };
    }

    const sanitized = trimExcerpt(raw);
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
    const title = (titleMatch?.[1] ?? new URL(exactUrl).hostname).replace(CONTROL_CHARS, "").trim().slice(0, 500) || new URL(exactUrl).hostname;
    const responseSha256 = sha256Text(raw);
    const contentSha256 = sha256Text(raw);
    const excerptSha256 = sha256Text(sanitized);
    const researchPayloadSha256 = canonicalDigest("research-payload", {
      final_url: exactUrl,
      title,
      content_sha256: contentSha256,
      excerpt_sha256: excerptSha256
    });
    const receipt = buildReceipt({
      reservation,
      status: "completed",
      responseStatus: response.status,
      responseBytes,
      responseSha256,
      finalUrl: exactUrl,
      researchPayloadSha256,
      usage: null,
      diagnosticCode: null,
      now,
      activeMs: Math.max(0, now().getTime() - startedAt.getTime())
    });
    const source = buildSuccessSource({
      repositoryIdentity,
      runId,
      commitSha,
      queryId,
      authority,
      authorityEpoch,
      reservation,
      receipt,
      finalUrl: exactUrl,
      title,
      content: raw,
      excerpt: sanitized,
      now
    });
    const sourceSha256 = canonicalDigest("research-source", source);
    const manifest = buildManifest({ reservation, receipt, sourceSha256, researchPayloadSha256: source.research_payload_sha256, outcome: "success" });
    await publishReceipt(receipt);
    await writeTerminalAtomic(paths, { manifest, receipt, source, gap: null });
    return { created: true, paths, reservation, receipt, source, gap: null, manifest };
  } catch (error) {
    const receipt = buildReceipt({
      reservation,
      status: "failed",
      responseStatus: null,
      responseBytes: 0,
      responseSha256: null,
      finalUrl: null,
      researchPayloadSha256: null,
      usage: null,
      diagnosticCode: "RESEARCH_TIMEOUT",
      now,
      activeMs: Math.max(0, now().getTime() - startedAt.getTime())
    });
    await publishReceipt(receipt);
    const gap = buildGap({
      queryId,
      reservation,
      reason: "timeout",
      summary: responseSummary(error, "Research request failed."),
      sourceRefs: [sourceRefFromQuery({ id: queryId, query_sha256: subject.query_set_sha256 }), sourceRefFromRecipe(requestRecipe)]
    });
    const manifest = buildManifest({ reservation, receipt, gapSha256: canonicalDigest("research-gap", gap), outcome: "failure" });
    await writeTerminalAtomic(paths, { manifest, receipt, source: null, gap });
    return { created: true, paths, reservation, receipt, source: null, gap, manifest };
  }
}

export {
  buildResearchQueryText,
  createResearchOriginCandidate,
  createResearchRequestRecipe,
  createNetworkResearchSubject,
  normalizeExactHttpsUrl
};
