import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { defaultSupervisorRoot } from "./data-store.mjs";
import { loadCapabilityAuthorizationView } from "./capability-authorization.mjs";
import { listGoalRunReviews, loadRunInteraction, loadRunScorecard } from "./goal-run-store.mjs";
import { loadVerificationReview } from "./verification-review.mjs";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return Array.isArray(match?.[1]) ? match[1][0] : match?.[1];
}

function tokenMatches(expected, actual) {
  if (!/^[0-9a-f]{64}$/.test(expected ?? "") || !/^[0-9a-f]{64}$/.test(actual ?? "")) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

function response(status, body, allowedOrigin, includeCors = true) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(includeCors ? {
        "access-control-allow-origin": allowedOrigin,
        vary: "Origin"
      } : {})
    },
    body: body === undefined ? "" : `${JSON.stringify(body)}\n`
  };
}

export function createReviewApiResponder({ dataRoot, repositoryIdentity, declarationReview = null, token, allowedOrigin, now, supervisorRoot = defaultSupervisorRoot(), verificationReviewLoader = loadVerificationReview }) {
  const origin = new URL(allowedOrigin).origin;
  if (origin !== allowedOrigin) throw new Error("Review UI origin must be an exact origin without path, query, or fragment.");
  if (!/^[0-9a-f]{64}$/.test(token ?? "")) throw new Error("Review service token must contain 256 bits of hexadecimal entropy.");

  return async ({ method = "GET", url = "/", headers = {} }) => {
    const requestOrigin = headerValue(headers, "origin");
    if (requestOrigin !== origin) return response(403, { error: "origin_denied" }, origin, false);

    if (method === "OPTIONS") {
      if (headerValue(headers, "access-control-request-method") !== "GET") {
        return response(405, { error: "method_not_allowed" }, origin);
      }
      const preflight = response(204, undefined, origin);
      preflight.headers["access-control-allow-methods"] = "GET, OPTIONS";
      preflight.headers["access-control-allow-headers"] = "X-DevHarness-Review-Token";
      preflight.headers["access-control-allow-private-network"] = "true";
      return preflight;
    }
    if (method !== "GET") return response(405, { error: "method_not_allowed" }, origin);
    if (!tokenMatches(token, headerValue(headers, "x-devharness-review-token"))) {
      return response(401, { error: "authentication_required" }, origin);
    }
    if (/%(?:2e|2f|5c)/i.test(url)) return response(400, { error: "invalid_run_id" }, origin);

    const pathname = new URL(url, "http://127.0.0.1").pathname;
    try {
      if (pathname === "/api/review/runs") {
        const index = await listGoalRunReviews(dataRoot, repositoryIdentity, { limit: 100, ...(now ? { now } : {}) });
        return response(200, index, origin);
      }
      if (pathname === "/api/review/project-declaration") {
        return declarationReview ? response(200, declarationReview, origin) : response(404, { error: "project_declaration_not_found" }, origin);
      }
      if (pathname === "/api/review/verifications") {
        if (!declarationReview?.head_sha && verificationReviewLoader === loadVerificationReview) {
          return response(404, { error: "verification_review_not_found" }, origin);
        }
        return response(200, await verificationReviewLoader({
          dataRoot,
          supervisorRoot,
          repositoryIdentity,
          currentHeadSha: declarationReview?.head_sha
        }), origin);
      }
      const match = pathname.match(/^\/api\/review\/runs\/([^/]+)\/scorecard$/);
      if (match) {
        if (!IDENTIFIER.test(match[1])) return response(400, { error: "invalid_run_id" }, origin);
        try {
          return response(200, await loadRunScorecard(dataRoot, repositoryIdentity, match[1]), origin);
        } catch {
          return response(404, { error: "run_not_found" }, origin);
        }
      }
      const interactionMatch = pathname.match(/^\/api\/review\/runs\/([^/]+)\/interaction$/);
      if (interactionMatch) {
        if (!IDENTIFIER.test(interactionMatch[1])) return response(400, { error: "invalid_run_id" }, origin);
        try {
          const packet = await loadRunInteraction(dataRoot, repositoryIdentity, interactionMatch[1]);
          return packet ? response(200, packet, origin) : response(404, { error: "interaction_not_found" }, origin);
        } catch {
          return response(404, { error: "run_not_found" }, origin);
        }
      }
      const capabilityMatch = pathname.match(/^\/api\/review\/runs\/([^/]+)\/capabilities$/);
      if (capabilityMatch) {
        if (!IDENTIFIER.test(capabilityMatch[1])) return response(400, { error: "invalid_run_id" }, origin);
        try {
          return response(200, await loadCapabilityAuthorizationView({
            dataRoot,
            supervisorRoot,
            repositoryIdentity,
            runId: capabilityMatch[1],
            ...(now ? { now: new Date(now) } : {})
          }), origin);
        } catch {
          return response(404, { error: "capabilities_not_found" }, origin);
        }
      }
      return response(404, { error: "not_found" }, origin);
    } catch {
      return response(500, { error: "review_data_unavailable" }, origin);
    }
  };
}

export async function startReviewServer({
  dataRoot,
  repositoryIdentity,
  declarationReview = null,
  port = 4317,
  allowedOrigin = "http://localhost:3000",
  token = randomBytes(32).toString("hex"),
  supervisorRoot = defaultSupervisorRoot()
}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Review service port must be between 1024 and 65535.");
  const respond = createReviewApiResponder({ dataRoot, repositoryIdentity, declarationReview, token, allowedOrigin, supervisorRoot });
  const server = createServer(async (request, nodeResponse) => {
    const result = await respond({ method: request.method, url: request.url, headers: request.headers });
    nodeResponse.writeHead(result.status, result.headers);
    nodeResponse.end(result.body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return { server, token, origin: `http://127.0.0.1:${port}`, allowedOrigin };
}
