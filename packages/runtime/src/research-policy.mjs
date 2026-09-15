import { createHash } from "node:crypto";
import net from "node:net";

import { canonicalDigest, canonicalJson, canonicalRecordId } from "./canonical-records.mjs";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HTTPS_ORIGIN = /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/;
const SECRETISH = /(?:gh[pousr]_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9]{8,}|BEGIN [A-Z ]*PRIVATE KEY|-----BEGIN|password=|secret=|token=|\/Users\/|\/private\/|[A-Za-z]:\\)/i;

export class ResearchPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ResearchPolicyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ResearchPolicyError(code, message);
}

function validIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail("INVALID_IDENTIFIER", `${label} is invalid.`);
  return value;
}

function isLocalHost(hostname) {
  const lower = String(hostname ?? "").toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  if (net.isIP(lower) > 0) return true;
  return false;
}

function normalizeAuthorityUrl(input, { label, allowPath = true } = {}) {
  if (typeof input !== "string" || input.length < 1 || input.length > 2048) fail("INVALID_URL", `${label} must be a string URL.`);
  const parsed = new URL(input);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) fail("INVALID_URL", `${label} must use exact HTTPS without credentials or fragments.`);
  if (isLocalHost(parsed.hostname)) fail("INVALID_URL", `${label} must not target localhost, a local domain, or an IP literal.`);
  if (!HTTPS_ORIGIN.test(parsed.origin)) fail("INVALID_URL", `${label} must be an exact HTTPS origin.`);
  if (!allowPath && parsed.pathname !== "/") fail("INVALID_URL", `${label} must be an exact HTTPS origin.`);
  return input;
}

function cleanResearchToken(token) {
  const text = String(token ?? "").trim();
  if (!text || SECRETISH.test(text)) return null;
  return text.replace(/\s+/g, " ");
}

export function buildResearchQueryText({ originalGoal, dependencySignals = [], publicIdentifiers = [], maxLength = 512 } = {}) {
  const segments = [];
  const goal = cleanResearchToken(originalGoal);
  if (goal) segments.push(goal);
  for (const signal of dependencySignals) {
    if (!signal) continue;
    if (typeof signal === "string") {
      const text = cleanResearchToken(signal);
      if (text) segments.push(text);
      continue;
    }
    if (typeof signal === "object") {
      const parts = [];
      for (const key of ["name", "version", "package", "framework", "tool", "product"]) {
        const value = cleanResearchToken(signal[key]);
        if (value) parts.push(value);
      }
      if (parts.length > 0) segments.push(parts.join(" "));
    }
  }
  for (const item of publicIdentifiers) {
    const text = cleanResearchToken(item);
    if (text) segments.push(text);
  }
  const unique = [];
  const seen = new Set();
  for (const segment of segments) {
    if (seen.has(segment)) continue;
    seen.add(segment);
    unique.push(segment);
  }
  const query = unique.join("; ");
  return query.length <= maxLength ? query : query.slice(0, maxLength).trimEnd();
}

export function normalizeExactHttpsOrigin(origin) {
  return normalizeAuthorityUrl(origin, { label: "Origin", allowPath: false });
}

export function normalizeExactHttpsUrl(url, allowedOrigins = null) {
  const normalized = normalizeAuthorityUrl(url, { label: "URL", allowPath: true });
  if (Array.isArray(allowedOrigins) && allowedOrigins.length > 0) {
    const allowed = allowedOrigins.map((origin, index) => normalizeExactHttpsOrigin(origin, `Allowed origin ${index + 1}`));
    if (!allowed.includes(new URL(normalized).origin)) fail("ORIGIN_NOT_ALLOWED", "URL origin is not one of the approved origins.");
  }
  return normalized;
}

export function createResearchOriginCandidate({ id, origin, source, sourceSha256 } = {}) {
  validIdentifier(id, "Origin candidate id");
  const normalizedOrigin = normalizeExactHttpsOrigin(origin);
  if (!["developer-input", "signed-runtime-registry", "agent-suggestion"].includes(source)) fail("INVALID_SOURCE", "Origin candidate source is invalid.");
  if (typeof sourceSha256 !== "string" || !SHA256.test(sourceSha256)) fail("INVALID_SOURCE", "Origin candidate source hash is invalid.");
  return Object.freeze({ id, origin: normalizedOrigin, source, source_sha256: sourceSha256 });
}

export function createResearchRequestRecipe({
  id,
  originId,
  url,
  deadlineSeconds = 30,
  maxResponseBytes = 2_097_152,
  method = "GET",
  headerProfile = "public-text-v1",
  body = null,
  allowedOrigins = null
} = {}) {
  validIdentifier(id, "Request recipe id");
  validIdentifier(originId, "Request recipe origin id");
  if (method !== "GET") fail("INVALID_METHOD", "Research request recipes must use GET.");
  if (headerProfile !== "public-text-v1") fail("INVALID_HEADERS", "Research request recipes must use the public-text-v1 header profile.");
  if (body !== null) fail("INVALID_BODY", "Research request recipes must not carry a body.");
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds < 1 || deadlineSeconds > 30) fail("INVALID_DEADLINE", "Research request deadline must be between 1 and 30 seconds.");
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 2_097_152) fail("INVALID_LIMIT", "Research response ceiling must be between 1 byte and 2 MiB.");
  const normalizedUrl = normalizeExactHttpsUrl(url, allowedOrigins);
  const recipe = {
    schema_version: 1,
    id,
    adapter: "exact-https-get-v1",
    url: normalizedUrl,
    origin_id: originId,
    method,
    header_profile: headerProfile,
    body,
    deadline_seconds: deadlineSeconds,
    max_response_bytes: maxResponseBytes
  };
  recipe.recipe_sha256 = canonicalDigest("research-request-recipe", recipe, ["recipe_sha256"]);
  return Object.freeze(recipe);
}

export function createNetworkResearchSubject({
  operationId,
  queries,
  origins,
  maxQueries,
  maxSourcesPerQuery,
  maxRequests,
  maxRedirectsPerRequest,
  maxResponseBytes,
  maxTotalBytes,
  requestDeadlineSeconds
} = {}) {
  validIdentifier(operationId, "Operation id");
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > 5) fail("INVALID_QUERY_SET", "Research query set must contain 1 to 5 queries.");
  if (!Array.isArray(origins) || origins.length < 1 || origins.length > 10) fail("INVALID_ORIGIN_SET", "Research origin set must contain 1 to 10 origins.");
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 5) fail("INVALID_LIMIT", "maxQueries must be between 1 and 5.");
  if (!Number.isInteger(maxSourcesPerQuery) || maxSourcesPerQuery < 1 || maxSourcesPerQuery > 5) fail("INVALID_LIMIT", "maxSourcesPerQuery must be between 1 and 5.");
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 25) fail("INVALID_LIMIT", "maxRequests must be between 1 and 25.");
  if (!Number.isInteger(maxRedirectsPerRequest) || maxRedirectsPerRequest < 0 || maxRedirectsPerRequest > 3) fail("INVALID_LIMIT", "maxRedirectsPerRequest must be between 0 and 3.");
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 2_097_152) fail("INVALID_LIMIT", "maxResponseBytes must be between 1 byte and 2 MiB.");
  if (!Number.isInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > 10_485_760) fail("INVALID_LIMIT", "maxTotalBytes must be between 1 byte and 10 MiB.");
  if (!Number.isInteger(requestDeadlineSeconds) || requestDeadlineSeconds < 1 || requestDeadlineSeconds > 30) fail("INVALID_LIMIT", "requestDeadlineSeconds must be between 1 and 30.");
  const querySetSha256 = canonicalDigest("research-query-set", queries);
  const subject = {
    schema_version: 1,
    id: "pending",
    operation_id: operationId,
    query_set_sha256: querySetSha256,
    queries: structuredClone(queries),
    origins: structuredClone(origins),
    max_queries: maxQueries,
    max_sources_per_query: maxSourcesPerQuery,
    max_requests: maxRequests,
    max_redirects_per_request: maxRedirectsPerRequest,
    max_response_bytes: maxResponseBytes,
    max_total_bytes: maxTotalBytes,
    request_deadline_seconds: requestDeadlineSeconds,
    reversibility: "revocable-before-next-request"
  };
  subject.subject_sha256 = canonicalDigest("network-research-subject", subject, ["id", "subject_sha256"]);
  subject.id = canonicalRecordId("network-research-subject", subject);
  return Object.freeze(subject);
}

export function nextResearchAuthorityEpoch({ subject, previous = null } = {}) {
  if (!subject || typeof subject !== "object" || !SHA256.test(subject.subject_sha256 ?? "")) {
    fail("INVALID_SUBJECT", "Research subject is invalid.");
  }
  if (!previous) return Object.freeze({ epoch: 1, subject_sha256: subject.subject_sha256 });
  if (previous.subject_sha256 !== subject.subject_sha256) fail("AUTHORITY_CHANGED", "Research authority changed; renewal is only allowed for the byte-identical subject.");
  if (!Number.isInteger(previous.epoch) || previous.epoch < 1 || previous.epoch > 19) fail("AUTHORITY_LIMIT", "Research authority epoch cannot be incremented further.");
  return Object.freeze({ epoch: previous.epoch + 1, subject_sha256: subject.subject_sha256 });
}

export function validateResearchRedirect({ fromUrl, location, allowedOrigins } = {}) {
  const source = normalizeExactHttpsUrl(fromUrl, allowedOrigins);
  const resolved = new URL(location, source).toString();
  try {
    return normalizeExactHttpsUrl(resolved, allowedOrigins);
  } catch (error) {
    if (error instanceof ResearchPolicyError && error.code === "ORIGIN_NOT_ALLOWED") {
      fail("REDIRECT_DENIED", "Redirect leaves the approved origin set.");
    }
    throw error;
  }
}

export function isOutboundResearchQuerySafe(query) {
  return typeof query === "string" && !SECRETISH.test(query);
}

export { canonicalJson };
