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

function response(status, body, allowedOrigin = null, extraHeaders = {}, { raw = false, contentType = null } = {}) {
  const headers = {
    "content-type": contentType
      ?? (raw ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8"),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin, vary: "Origin" } : {}),
    ...extraHeaders
  };
  let encoded;
  if (raw) {
    encoded = body === undefined || body === null ? "" : String(body);
  } else {
    encoded = body === undefined ? "" : `${JSON.stringify(body)}\n`;
  }
  return { status, headers, body: encoded };
}

function encodeResponsesSseFromJson(payload) {
  const completed = {
    type: "response.completed",
    response: payload
  };
  return `event: response.completed\ndata: ${JSON.stringify(completed)}\n\n`;
}

function extractUsageFromSse(text) {
  let usage = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      const candidate = event?.response?.usage ?? event?.usage ?? null;
      const normalized = normalizeUsage(candidate);
      if (normalized) usage = normalized;
    } catch {}
  }
  return usage;
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

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  let total = usage.total_tokens;
  if (!Number.isSafeInteger(total) && Number.isSafeInteger(input) && Number.isSafeInteger(output)) {
    total = input + output;
  }
  const normalized = {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total
  };
  return validateUsage(normalized) ? normalized : null;
}

function extractUsage(payload) {
  return normalizeUsage(payload?.usage);
}

const CHATGPT_UNSUPPORTED_BODY_KEYS = Object.freeze([
  "max_output_tokens",
  "max_tokens",
  "temperature"
]);

function isChatgptProxyOrigin(origin) {
  try {
    return new URL(String(origin ?? "")).hostname === "chatgpt.com";
  } catch {
    return false;
  }
}

function resolveParentCredentialValue(parentCredential) {
  if (typeof parentCredential === "function") {
    const value = parentCredential();
    if (typeof value !== "string" || value.length < 1 || value.length > 4096) {
      throw new Error("Parent provider credential is invalid.");
    }
    return value;
  }
  if (typeof parentCredential !== "string" || parentCredential.length < 1 || parentCredential.length > 4096) {
    throw new Error("Parent provider credential is invalid.");
  }
  return parentCredential;
}

function upstreamHeaders({
  parentCredential,
  includeJsonContentType = false,
  chatgptAccountId = null,
  upstreamExtraHeaders = null
}) {
  const headers = {
    authorization: `Bearer ${resolveParentCredentialValue(parentCredential)}`,
    ...(includeJsonContentType ? { "content-type": "application/json" } : {})
  };
  if (typeof chatgptAccountId === "string" && chatgptAccountId.trim().length > 0) {
    headers["ChatGPT-Account-Id"] = chatgptAccountId.trim();
  }
  if (upstreamExtraHeaders && typeof upstreamExtraHeaders === "object" && !Array.isArray(upstreamExtraHeaders)) {
    for (const [key, value] of Object.entries(upstreamExtraHeaders)) {
      if (typeof key !== "string" || key.trim().length < 1) continue;
      if (typeof value !== "string" || value.length < 1) continue;
      const lower = key.toLowerCase();
      if (lower === "authorization" || lower === "x-devharness-proxy-token") continue;
      headers[key] = value;
    }
  }
  return headers;
}

function prepareChatgptForwardBody(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const next = { ...payload };
  for (const key of CHATGPT_UNSUPPORTED_BODY_KEYS) {
    if (Object.hasOwn(next, key)) delete next[key];
  }
  next.stream = true;
  return JSON.stringify(next);
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
  chatgptAccountId = null,
  chatgptMode = null,
  upstreamExtraHeaders = null,
  refreshParentCredential = null,
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
  // Validate credential shape once; getters are re-resolved per upstream call.
  resolveParentCredentialValue(parentCredential);
  if (refreshParentCredential !== null && refreshParentCredential !== undefined && typeof refreshParentCredential !== "function") {
    throw new Error("refreshParentCredential must be a function when provided.");
  }
  if (proxyPolicySha256 !== null && !SHA256.test(proxyPolicySha256)) throw new Error("Proxy policy digest is invalid.");
  if (targetDescriptorSha256 !== null && !SHA256.test(targetDescriptorSha256)) throw new Error("Target descriptor digest is invalid.");
  if (chatgptAccountId !== null && chatgptAccountId !== undefined) {
    if (typeof chatgptAccountId !== "string" || chatgptAccountId.trim().length < 1 || chatgptAccountId.length > 256) {
      throw new Error("ChatGPT account id is invalid.");
    }
  }
  const useChatgptMode = chatgptMode === true || isChatgptProxyOrigin(selectedOrigin);

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
    let clientWantedStream = Boolean(payload && typeof payload === "object" && payload.stream === true);
    // Keep the child's stream flag so Codex receives a real Responses SSE transcript.
    // ChatGPT Codex origin rejects several Responses params and requires stream:true.
    let forwardBody = requestBody;
    if (useChatgptMode && payload && typeof payload === "object" && !Array.isArray(payload)) {
      const rewritten = prepareChatgptForwardBody(payload);
      if (rewritten !== null) {
        forwardBody = rewritten;
        clientWantedStream = true;
      }
    }
    const reservation = requestReservation({
      operationId,
      attemptId,
      requestBytes,
      maxOutputTokens,
      targetOrigin: selectedOrigin,
      proxyPolicySha256,
      targetDescriptorSha256,
      bodySha256: createHash("sha256").update(forwardBody, "utf8").digest("hex")
    });
    await publishReservation(reservation);
    const startedAt = now().toISOString();

    let currentUrl = upstreamUrl(selectedOrigin, url);
    let redirectCount = 0;
    let refreshAttempted = false;
    while (true) {
      let upstreamResponse;
      try {
        upstreamResponse = await fetchImpl(currentUrl, {
          method,
          headers: upstreamHeaders({
            parentCredential,
            includeJsonContentType: method !== "GET" && forwardBody.length > 0,
            chatgptAccountId,
            upstreamExtraHeaders
          }),
          body: method === "GET" ? undefined : forwardBody,
          redirect: "manual"
        });
      } catch (error) {
        const receipt = requestReceipt({
          reservation,
          status: "failed",
          responseStatus: 0,
          responseBytes: 0,
          responseSha256: null,
          usage: null,
          finalUrl: currentUrl,
          diagnosticCode: "USAGE_UNAVAILABLE"
        });
        await publishReceipt(receipt);
        return response(502, { error: "upstream_fetch_failed", detail: String(error?.message ?? error).slice(0, 300) });
      }

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

      // ChatGPT session: one reactive refresh+retry on upstream 401 (Codex-style).
      if (
        useChatgptMode
        && upstreamResponse.status === 401
        && typeof refreshParentCredential === "function"
        && !refreshAttempted
      ) {
        refreshAttempted = true;
        try {
          await refreshParentCredential();
          continue;
        } catch (refreshError) {
          const receipt = requestReceipt({
            reservation,
            status: "failed",
            responseStatus: 401,
            responseBytes: 0,
            responseSha256: null,
            usage: null,
            finalUrl: currentUrl,
            diagnosticCode: "AUTH_UNAVAILABLE"
          });
          await publishReceipt(receipt);
          return response(401, {
            error: "auth_unavailable",
            detail: String(refreshError?.message ?? refreshError).slice(0, 300)
          });
        }
      }

      const upstreamContentType = upstreamResponse.headers?.get?.("content-type") ?? "";
      if (clientWantedStream || /text\/event-stream/i.test(upstreamContentType)) {
        const sseText = await upstreamResponse.text();
        if (byteLength(sseText) > maxResponseBytes) {
          const receipt = requestReceipt({
            reservation,
            status: "failed",
            responseStatus: upstreamResponse.status,
            responseBytes: byteLength(sseText),
            responseSha256: createHash("sha256").update(sseText, "utf8").digest("hex"),
            usage: null,
            finalUrl: currentUrl,
            diagnosticCode: "RESOURCE_LIMIT"
          });
          await publishReceipt(receipt);
          return response(413, { error: "response_limit_exceeded" });
        }
        if (upstreamResponse.status >= 400) {
          const receipt = requestReceipt({
            reservation,
            status: "failed",
            responseStatus: upstreamResponse.status,
            responseBytes: byteLength(sseText),
            responseSha256: createHash("sha256").update(sseText, "utf8").digest("hex"),
            usage: null,
            finalUrl: currentUrl,
            diagnosticCode: "USAGE_UNAVAILABLE"
          });
          await publishReceipt(receipt);
          return response(upstreamResponse.status, sseText, null, {
            "x-devharness-proxy-operation": operationId,
            "x-devharness-proxy-attempt": attemptId,
            "x-devharness-proxy-error": "upstream_client_error"
          }, { raw: true, contentType: upstreamContentType || "text/event-stream; charset=utf-8" });
        }
        const usage = extractUsageFromSse(sseText);
        if (!usage) {
          const receipt = requestReceipt({
            reservation,
            status: "failed",
            responseStatus: upstreamResponse.status,
            responseBytes: byteLength(sseText),
            responseSha256: createHash("sha256").update(sseText, "utf8").digest("hex"),
            usage: null,
            finalUrl: currentUrl,
            diagnosticCode: "USAGE_UNAVAILABLE"
          });
          await publishReceipt(receipt);
          return response(502, {
            error: "usage_unavailable",
            upstream_status: upstreamResponse.status,
            content_type: upstreamContentType,
            body_prefix: String(sseText ?? "").slice(0, 240)
          });
        }
        const receipt = requestReceipt({
          reservation,
          status: "completed",
          responseStatus: upstreamResponse.status,
          responseBytes: byteLength(sseText),
          responseSha256: createHash("sha256").update(sseText, "utf8").digest("hex"),
          usage,
          finalUrl: null,
          diagnosticCode: null
        });
        await publishReceipt(receipt);
        return response(200, sseText, null, {
          "x-devharness-proxy-operation": operationId,
          "x-devharness-proxy-attempt": attemptId,
          "x-devharness-proxy-started-at": startedAt
        }, { raw: true, contentType: "text/event-stream; charset=utf-8" });
      }

      const parsed = await parseJSONResponse(upstreamResponse, maxResponseBytes);
      if (upstreamResponse.status >= 400 && parsed.payload && typeof parsed.payload === "object" && parsed.payload.error) {
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
        return response(upstreamResponse.status, parsed.payload, null, {
          "x-devharness-proxy-operation": operationId,
          "x-devharness-proxy-attempt": attemptId,
          "x-devharness-proxy-error": "upstream_client_error"
        });
      }
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
        const rawUsage = parsed.payload?.usage;
        return response(502, {
          error: "usage_unavailable",
          upstream_status: upstreamResponse.status,
          content_type: upstreamResponse.headers?.get?.("content-type") ?? null,
          payload_type: parsed.payload == null ? "null" : Array.isArray(parsed.payload) ? "array" : typeof parsed.payload,
          usage_keys: rawUsage && typeof rawUsage === "object" ? Object.keys(rawUsage) : null,
          usage_preview: rawUsage && typeof rawUsage === "object"
            ? {
                input_tokens: rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? null,
                output_tokens: rawUsage.output_tokens ?? rawUsage.completion_tokens ?? null,
                total_tokens: rawUsage.total_tokens ?? null
              }
            : null,
          body_prefix: String(parsed.text ?? "").slice(0, 240)
        });
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
      const proxyHeaders = {
        "x-devharness-proxy-operation": operationId,
        "x-devharness-proxy-attempt": attemptId,
        "x-devharness-proxy-started-at": startedAt
      };
      if (clientWantedStream) {
        return response(
          200,
          encodeResponsesSseFromJson(parsed.payload ?? { data: parsed.text }),
          null,
          proxyHeaders,
          { raw: true }
        );
      }
      return response(upstreamResponse.status, parsed.payload ?? { data: parsed.text }, null, proxyHeaders);
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
