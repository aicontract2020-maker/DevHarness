export const POLL_INTERVAL_MS = 5000;

export function parseReviewConnection(hash) {
  const parameters = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  const api = parameters.get("api");
  const token = parameters.get("token");
  if (!api || !/^[0-9a-f]{64}$/.test(token ?? "")) return null;
  try {
    const parsed = new URL(api);
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
    return { apiOrigin: parsed.origin, token };
  } catch {
    return null;
  }
}

export function selectRunId(runs, currentRunId) {
  if (runs.some((run) => run.run_id === currentRunId)) return currentRunId;
  return runs[0]?.run_id ?? null;
}

export async function fetchReviewIndex(connection, signal) {
  const response = await fetch(`${connection.apiOrigin}/api/review/runs`, {
    headers: { "X-DevHarness-Review-Token": connection.token },
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`Review index returned ${response.status}.`);
  return response.json();
}

export async function fetchProjectDeclarationReview(connection, signal) {
  const response = await fetch(`${connection.apiOrigin}/api/review/project-declaration`, {
    headers: { "X-DevHarness-Review-Token": connection.token },
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`Project declaration review returned ${response.status}.`);
  return response.json();
}

export async function fetchVerificationReview(connection, signal) {
  const response = await fetch(`${connection.apiOrigin}/api/review/verifications`, {
    headers: { "X-DevHarness-Review-Token": connection.token },
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`Verification review returned ${response.status}.`);
  return response.json();
}

export async function fetchReviewScorecard(connection, scorecardUrl, signal) {
  if (!/^\/api\/review\/runs\/[A-Za-z][A-Za-z0-9._:-]{0,127}\/scorecard$/.test(scorecardUrl)) {
    throw new Error("Review index returned an invalid scorecard path.");
  }
  const response = await fetch(`${connection.apiOrigin}${scorecardUrl}`, {
    headers: { "X-DevHarness-Review-Token": connection.token },
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`Review scorecard returned ${response.status}.`);
  return response.json();
}

export async function fetchReviewInteraction(connection, interactionUrl, signal) {
  if (!/^\/api\/review\/runs\/[A-Za-z][A-Za-z0-9._:-]{0,127}\/interaction$/.test(interactionUrl)) {
    throw new Error("Review index returned an invalid interaction path.");
  }
  const response = await fetch(`${connection.apiOrigin}${interactionUrl}`, {
    headers: { "X-DevHarness-Review-Token": connection.token },
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`Review interaction returned ${response.status}.`);
  return response.json();
}

export async function fetchCapabilityAuthorizations(connection, capabilitiesUrl, signal) {
  if (!/^\/api\/review\/runs\/[A-Za-z][A-Za-z0-9._:-]{0,127}\/capabilities$/.test(capabilitiesUrl)) {
    throw new Error("Review index returned an invalid capabilities path.");
  }
  const response = await fetch(`${connection.apiOrigin}${capabilitiesUrl}`, {
    headers: { "X-DevHarness-Review-Token": connection.token },
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`Capability review returned ${response.status}.`);
  return response.json();
}
