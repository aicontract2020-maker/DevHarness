import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { canonicalDigest, canonicalJson, canonicalRecordId } from "./canonical-records.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const PRIVATE_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/i;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 2_097_152;
const MAX_REDIRECTS = 3;

function exactHttpsOrigin(origin, label = "Origin") {
  if (typeof origin !== "string" || origin.length < 1 || origin.length > 2048) {
    throw new Error(`${label} must be an exact HTTPS origin.`);
  }
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an exact HTTPS origin.`);
  }
  if (PRIVATE_HOST.test(parsed.hostname)) throw new Error(`${label} must not target localhost or a private host.`);
  return origin;
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1];
}

function parseBearer(value) {
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(.+)$/.exec(value.trim());
  return match ? match[1] : null;
}

function tokenMatches(expected, actual) {
  if (typeof expected !== "string" || typeof actual !== "string" || expected.length < 1 || actual.length < 1) return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function response(status, body, allowedOrigin = null, extraHeaders = {}) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin, vary: "Origin" } : {}),
      ...extraHeaders
    },
    body: body === undefined ? "" : `${JSON.stringify(body)}\n`
  };
}

function byteLength(text) {
  return Buffer.byteLength(text ?? "", "utf8");
}

function requestReservation({
  operationId,
  attemptId,
  requestBytes,
  maxOutputTokens,
  targetOrigin,
  proxyPolicySha256,
  targetDescriptorSha256,
  bodySha256
}) {
  const reservedAt = new Date().toISOString();
  const reservation = {
    schema_version: 1,
    id: canonicalRecordId("outbound-request-reservation", {
      schema_version: 1,
      operation_id: operationId,
      attempt_id: attemptId,
      channel: "provider",
      target_origin: targetOrigin,
      target_descriptor_sha256: targetDescriptorSha256,
      proxy_policy_sha256: proxyPolicySha256,
      request_bytes: requestBytes,
      body_sha256: bodySha256,
      reserved_input_tokens: requestBytes + maxOutputTokens,
      reserved_output_tokens: maxOutputTokens,
      reserved_tokens: requestBytes + (2 * maxOutputTokens),
      reserved_response_bytes: 0,
      reserved_active_ms: 0
    }),
    operation_id: operationId,
    attempt_id: attemptId,
    channel: "provider",
    target_origin: targetOrigin,
    target_descriptor_sha256: targetDescriptorSha256,
    proxy_policy_sha256: proxyPolicySha256,
    request_bytes: requestBytes,
    body_sha256: bodySha256,
    reserved_input_tokens: requestBytes + maxOutputTokens,
    reserved_output_tokens: maxOutputTokens,
    reserved_tokens: requestBytes + (2 * maxOutputTokens),
    reserved_response_bytes: 0,
    reserved_active_ms: 0,
    reserved_at: reservedAt
  };
  reservation.reservation_sha256 = canonicalDigest("outbound-request-reservation", reservation, ["id", "reservation_sha256"]);
  reservation.id = canonicalRecordId("outbound-request-reservation", reservation);
  return reservation;
}

function requestReceipt({
  reservation,
  status,
  responseStatus,
  responseBytes,
  responseSha256,
  usage,
  finalUrl = null,
  diagnosticCode = null
}) {
  const completedAt = new Date().toISOString();
  const receipt = {
    schema_version: 1,
    id: canonicalRecordId("outbound-request-receipt", {
      schema_version: 1,
      reservation_id: reservation.id,
      reservation_sha256: reservation.reservation_sha256,
      status,
      completed_at: completedAt,
      response_status: responseStatus,
      response_bytes: responseBytes,
      active_ms: 0,
      response_sha256: responseSha256,
      final_url: finalUrl,
      research_payload_sha256: null,
      usage,
      diagnostic_code: diagnosticCode
    }),
    reservation_id: reservation.id,
    reservation_sha256: reservation.reservation_sha256,
    status,
    completed_at: completedAt,
    response_status: responseStatus,
    response_bytes: responseBytes,
    active_ms: 0,
    response_sha256: responseSha256,
    final_url: finalUrl,
    research_payload_sha256: null,
    usage,
    diagnostic_code: diagnosticCode
  };
  receipt.receipt_sha256 = canonicalDigest("outbound-request-receipt", receipt, ["id", "receipt_sha256"]);
  receipt.id = canonicalRecordId("outbound-request-receipt", receipt);
  return receipt;
}

function serializeBody(body) {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body === "object") return canonicalJson(body);
  throw new TypeError("Proxy request body must be text, bytes, or JSON-compatible data.");
}

function validateUsage(usage) {
  return usage && typeof usage === "object"
    && Object.keys(usage).sort().join("\0") === ["input_tokens", "output_tokens", "total_tokens"].join("\0")
    && Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0
    && Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0
    && Number.isSafeInteger(usage.total_tokens) && usage.total_tokens === usage.input_tokens + usage.output_tokens;
}

function extractUsage(payload) {
  const usage = payload?.usage;
  return validateUsage(usage) ? usage : null;
}

function upstreamHeaders({ parentCredential }) {
  return { authorization: `Bearer ${parentCredential}` };
}

async function parseJSONResponse(response, maxResponseBytes) {
  const text = await response.text();
  if (byteLength(text) > maxResponseBytes) {
    return { oversized: true, text };
  }
  try {
    return { oversized: false, text, payload: text.length > 0 ? JSON.parse(text) : null };
  } catch {
    return { oversized: false, text, payload: null };
  }
}

function upstreamUrl(origin, url) {
  const path = typeof url === "string" ? url : String(url ?? "");
  if (!path.startsWith("/")) throw new Error("Proxy request URL must be path-relative.");
  return new URL(path, `${origin}/`).toString();
}

export function createProviderProxyResponder({
  exactOrigins,
  targetOrigin = null,
  childToken,
  parentCredential,
  operationId,
  attemptId,
  targetDescriptorSha256 = null,
  proxyPolicySha256 = null,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  maxRequestBytes = MAX_REQUEST_BYTES,
  maxRedirects = MAX_REDIRECTS,
  publishReservation = async () => {},
  publishReceipt = async () => {},
  fetchImpl = fetch,
  now = () => new Date()
} = {}) {
  const allowedOrigins = Array.isArray(exactOrigins) ? exactOrigins.map((origin, index) => exactHttpsOrigin(origin, `Allowed origin ${index + 1}`)) : [];
  if (allowedOrigins.length < 1 || allowedOrigins.length > 5) throw new Error("Provider proxy requires 1 to 5 exact allowed origins.");
  const selectedOrigin = exactHttpsOrigin(targetOrigin ?? allowedOrigins[0], "Target origin");
  if (!allowedOrigins.includes(selectedOrigin)) throw new Error("Target origin must be one of the allowed origins.");
  if (!IDENTIFIER.test(operationId ?? "") || !IDENTIFIER.test(attemptId ?? "")) throw new Error("Provider proxy requires stable operation and attempt identifiers.");
  if (typeof childToken !== "string" || childToken.length < 1 || childToken.length > 512) throw new Error("Child proxy token is invalid.");
  if (typeof parentCredential !== "string" || parentCredential.length < 1 || parentCredential.length > 4096) throw new Error("Parent provider credential is invalid.");
  if (proxyPolicySha256 !== null && !SHA256.test(proxyPolicySha256)) throw new Error("Proxy policy digest is invalid.");
  if (targetDescriptorSha256 !== null && !SHA256.test(targetDescriptorSha256)) throw new Error("Target descriptor digest is invalid.");

  return async ({ method = "POST", url = "/", headers = {}, body = "" }) => {
    const requestToken = parseBearer(headerValue(headers, "authorization")) ?? headerValue(headers, "x-devharness-proxy-token");
    if (!tokenMatches(childToken, requestToken ?? "")) return response(401, { error: "authentication_required" });
    if (method !== "POST" && method !== "GET") return response(405, { error: "method_not_allowed" });
    const requestBody = serializeBody(body);
    const requestBytes = byteLength(requestBody);
    if (requestBytes > maxRequestBytes) return response(413, { error: "request_limit_exceeded" });
    let payload = null;
    if (requestBody.length > 0) {
      try {
        payload = JSON.parse(requestBody);
      } catch {
        return response(400, { error: "invalid_json" });
      }
    }
    const maxOutputTokens = Number.isInteger(payload?.max_output_tokens) && payload.max_output_tokens >= 0 && payload.max_output_tokens <= 600000
      ? payload.max_output_tokens
      : 0;
    const reservation = requestReservation({
      operationId,
      attemptId,
      requestBytes,
      maxOutputTokens,
      targetOrigin: selectedOrigin,
      proxyPolicySha256,
      targetDescriptorSha256,
      bodySha256: createHash("sha256").update(requestBody, "utf8").digest("hex")
    });
    await publishReservation(reservation);
    const startedAt = now().toISOString();

    let currentUrl = upstreamUrl(selectedOrigin, url);
    let redirectCount = 0;
    while (true) {
      const upstreamResponse = await fetchImpl(currentUrl, {
        method,
        headers: upstreamHeaders({ parentCredential }),
        body: method === "GET" ? undefined : requestBody,
        redirect: "manual"
      });

      const isRedirect = upstreamResponse.status >= 300 && upstreamResponse.status < 400 && upstreamResponse.headers?.get?.("location");
      if (isRedirect) {
        redirectCount += 1;
        if (redirectCount > maxRedirects) {
          const receipt = requestReceipt({
            reservation,
            status: "failed",
            responseStatus: upstreamResponse.status,
            responseBytes: 0,
            responseSha256: null,
            usage: null,
            finalUrl: currentUrl,
            diagnosticCode: "RESOURCE_LIMIT"
          });
          await publishReceipt(receipt);
          return response(429, { error: "redirect_limit_exceeded" });
        }
        const nextUrl = new URL(upstreamResponse.headers.get("location"), currentUrl);
        if (!allowedOrigins.includes(nextUrl.origin)) {
          const receipt = requestReceipt({
            reservation,
            status: "failed",
            responseStatus: upstreamResponse.status,
            responseBytes: 0,
            responseSha256: null,
            usage: null,
            finalUrl: nextUrl.toString(),
            diagnosticCode: "ORIGIN_NOT_ALLOWED"
          });
          await publishReceipt(receipt);
          return response(403, { error: "redirect_denied" });
        }
        currentUrl = nextUrl.toString();
        continue;
      }

      const parsed = await parseJSONResponse(upstreamResponse, maxResponseBytes);
      if (parsed.oversized) {
        const receipt = requestReceipt({
          reservation,
          status: "failed",
          responseStatus: upstreamResponse.status,
          responseBytes: byteLength(parsed.text),
          responseSha256: createHash("sha256").update(parsed.text, "utf8").digest("hex"),
          usage: null,
          finalUrl: currentUrl,
          diagnosticCode: "RESOURCE_LIMIT"
        });
        await publishReceipt(receipt);
        return response(413, { error: "response_limit_exceeded" });
      }
      const usage = extractUsage(parsed.payload);
      if (!usage) {
        const receipt = requestReceipt({
          reservation,
          status: "failed",
          responseStatus: upstreamResponse.status,
          responseBytes: byteLength(parsed.text),
          responseSha256: createHash("sha256").update(parsed.text, "utf8").digest("hex"),
          usage: null,
          finalUrl: currentUrl,
          diagnosticCode: "USAGE_UNAVAILABLE"
        });
        await publishReceipt(receipt);
        return response(502, { error: "usage_unavailable" });
      }
      const receipt = requestReceipt({
        reservation,
        status: "completed",
        responseStatus: upstreamResponse.status,
        responseBytes: byteLength(parsed.text),
        responseSha256: createHash("sha256").update(parsed.text, "utf8").digest("hex"),
        usage,
        finalUrl: null,
        diagnosticCode: null
      });
      await publishReceipt(receipt);
      return response(upstreamResponse.status, parsed.payload ?? { data: parsed.text }, null, {
        "x-devharness-proxy-operation": operationId,
        "x-devharness-proxy-attempt": attemptId,
        "x-devharness-proxy-started-at": startedAt
      });
    }
  };
}

export async function startProviderProxyServer(options = {}) {
  const respond = createProviderProxyResponder(options);
  const server = createServer(async (request, nodeResponse) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const result = await respond({ method: request.method, url: request.url, headers: request.headers, body });
    nodeResponse.writeHead(result.status, result.headers);
    nodeResponse.end(result.body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  return { server, port: address.port, token: options.childToken, origin: `http://127.0.0.1:${address.port}` };
}
