export const POLL_INTERVAL_MS = 5000;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapSourceArtifact(artifact) {
  if (!isRecord(artifact)) throw new Error("Review packet contains an invalid source artifact.");
  return {
    id: stringValue(artifact.id),
    kind: stringValue(artifact.kind),
    sha256: stringValue(artifact.sha256)
  };
}

function mapInteractionItem(item) {
  if (!isRecord(item)) throw new Error("Review packet contains an invalid section item.");
  return {
    id: stringValue(item.id),
    text: stringValue(item.text),
    confidence: item.confidence === "confirmed" ? "confirmed" : "verify",
    severity: item.severity === "blocking" ? "blocking" : item.severity === "warning" ? "warning" : "info",
    source_refs: Array.isArray(item.source_refs) ? item.source_refs.filter((ref) => typeof ref === "string") : [],
    ...(Array.isArray(item.basis) && item.basis.length > 0 ? { basis: item.basis.filter((basis) => typeof basis === "string") } : {}),
    ...(isRecord(item.metrics) ? {
      metrics: {
        known_claims: numberValue(item.metrics.known_claims),
        total_claims: numberValue(item.metrics.total_claims),
        unknown_claims: numberValue(item.metrics.unknown_claims),
        conflict_claims: numberValue(item.metrics.conflict_claims)
      }
    } : {})
  };
}

function mapInteractionSection(section) {
  if (!isRecord(section)) throw new Error("Review packet contains an invalid section.");
  return {
    id: stringValue(section.id),
    title: stringValue(section.title),
    items: Array.isArray(section.items) ? section.items.map(mapInteractionItem) : []
  };
}

function summarizeInteractionSections(sections) {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const sectionItems = (...ids) => ids.map((id) => byId.get(id)?.items ?? []).find((items) => items.length > 0) ?? [];
  const outcome = sectionItems("alignment-outcome", "live-alignment-next", "live-alignment-context")[0]?.text ?? "";
  const understanding = sectionItems("alignment-understanding", "live-alignment-quantitative").map((item) => item.text);
  const boundaries = sectionItems("alignment-boundaries", "live-alignment-crew").map((item) => item.text);
  const criteria = sectionItems("alignment-criteria", "live-alignment-stages").map((item) => item.text);
  const questions = sectionItems("alignment-questions", "live-alignment-clarification", "live-alignment-questions").map((item) => item.text);
  return { outcome, understanding, boundaries, criteria, questions };
}

export function mapReviewRunSummary(run) {
  if (!isRecord(run)) throw new Error("Review index contains an invalid run summary.");
  return {
    run_id: stringValue(run.run_id),
    title: stringValue(run.title, stringValue(run.run_id)),
    state: stringValue(run.state, "unknown"),
    updated_at: stringValue(run.updated_at),
    head_sha: stringValue(run.head_sha),
    verdict: stringValue(run.verdict, "blocked"),
    proof_score: numberValue(run.proof_score),
    blocking_count: numberValue(run.blocking_count),
    scorecard_url: stringValue(run.scorecard_url),
    ...(typeof run.interaction_url === "string" ? { interaction_url: run.interaction_url } : {}),
    ...(typeof run.capabilities_url === "string" ? { capabilities_url: run.capabilities_url } : {})
  };
}

export function mapReviewIndex(index) {
  if (!isRecord(index) || !Array.isArray(index.runs)) throw new Error("Review index has an invalid shape.");
  return {
    schema_version: numberValue(index.schema_version, 1),
    repository_identity: stringValue(index.repository_identity),
    runs: index.runs.map(mapReviewRunSummary)
  };
}

export function mapInteractionPacket(packet) {
  if (!isRecord(packet) || !Array.isArray(packet.sections) || !Array.isArray(packet.actions) || !Array.isArray(packet.source_artifacts)) {
    throw new Error("Review packet has an invalid shape.");
  }
  const sections = packet.sections.map(mapInteractionSection);
  const sourceArtifacts = packet.source_artifacts.map(mapSourceArtifact);
  const actions = packet.actions
    .filter(isRecord)
    .map((action) => ({
      id: stringValue(action.id),
      label: stringValue(action.label),
      kind: stringValue(action.kind),
      recommended: action.recommended === true
    }));
  const recommendedAction = actions.find((action) => action.recommended) ?? null;
  const summary = summarizeInteractionSections(sections);
  return {
    schema_version: numberValue(packet.schema_version, 1),
    id: stringValue(packet.id),
    run_id: stringValue(packet.run_id),
    kind: stringValue(packet.kind),
    generated_at: stringValue(packet.generated_at),
    head_sha: stringValue(packet.head_sha),
    title: stringValue(packet.title),
    verdict: stringValue(packet.verdict),
    summary: stringValue(packet.summary),
    attention: isRecord(packet.attention)
      ? {
          required: packet.attention.required === true,
          count: numberValue(packet.attention.count),
          reasons: Array.isArray(packet.attention.reasons) ? packet.attention.reasons.filter((reason) => typeof reason === "string") : []
        }
      : { required: false, count: 0, reasons: [] },
    sections,
    decisions: Array.isArray(packet.decisions) ? packet.decisions.map((decision) => ({
      id: stringValue(decision?.id),
      question: stringValue(decision?.question),
      why_now: stringValue(decision?.why_now),
      impact: stringValue(decision?.impact),
      reversibility: stringValue(decision?.reversibility),
      recommended_option_id: stringValue(decision?.recommended_option_id),
      options: Array.isArray(decision?.options) ? decision.options.map((option) => ({
        id: stringValue(option?.id),
        label: stringValue(option?.label),
        outcome: stringValue(option?.outcome),
        tradeoffs: Array.isArray(option?.tradeoffs) ? option.tradeoffs.filter((tradeoff) => typeof tradeoff === "string") : []
      })) : []
    })) : [],
    actions,
    source_artifacts: sourceArtifacts,
    traceability: Array.isArray(packet.traceability) ? packet.traceability.map((item) => ({
      item_id: stringValue(item?.item_id),
      source_refs: Array.isArray(item?.source_refs) ? item.source_refs.filter((ref) => typeof ref === "string") : []
    })) : [],
    compression: isRecord(packet.compression)
      ? {
          source_artifact_count: numberValue(packet.compression.source_artifact_count, sourceArtifacts.length),
          surfaced_item_count: numberValue(packet.compression.surfaced_item_count),
          omitted_item_count: numberValue(packet.compression.omitted_item_count)
        }
      : {
          source_artifact_count: sourceArtifacts.length,
          surfaced_item_count: 0,
          omitted_item_count: 0
        },
    highlights: {
      outcome: summary.outcome,
      understanding: summary.understanding,
      boundaries: summary.boundaries,
      criteria: summary.criteria,
      questions: summary.questions,
      decision_count: Array.isArray(packet.decisions) ? packet.decisions.length : 0,
      recommended_action: recommendedAction?.label ?? null
    }
  };
}

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
  return mapReviewIndex(await response.json());
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
  return mapInteractionPacket(await response.json());
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
