export const POLL_INTERVAL_MS: 5000;

export type ReviewConnection = { apiOrigin: string; token: string };
export type ReviewRunSummary = { run_id: string; scorecard_url: string; interaction_url?: string; capabilities_url?: string; [key: string]: unknown };
export type InteractionPacket = { schema_version: number; id: string; run_id: string; kind: string; generated_at: string; head_sha: string; title: string; verdict: string; summary: string; attention: { required: boolean; count: number; reasons: string[] }; sections: Array<{ id: string; title: string; items: Array<{ id: string; text: string; confidence: "confirmed" | "verify"; severity: "info" | "warning" | "blocking"; source_refs: string[]; basis?: string[]; metrics?: { known_claims: number; total_claims: number; unknown_claims: number; conflict_claims: number } }> }>; decisions: Array<{ id: string; question: string; why_now: string; impact: string; reversibility: string; recommended_option_id: string; options: Array<{ id: string; label: string; outcome: string; tradeoffs: string[] }> }>; actions: Array<{ id: string; label: string; kind: string; recommended: boolean }>; source_artifacts: Array<{ id: string; kind: string; sha256: string }>; traceability: Array<{ item_id: string; source_refs: string[] }>; compression: { source_artifact_count: number; surfaced_item_count: number; omitted_item_count: number }; highlights: { outcome: string; understanding: string[]; boundaries: string[]; criteria: string[]; questions: string[]; decision_count: number; recommended_action: string | null } };

export function parseReviewConnection(hash: string): ReviewConnection | null;
export function selectRunId(runs: ReviewRunSummary[], currentRunId: string | null): string | null;
export function mapReviewRunSummary(run: unknown): ReviewRunSummary;
export function mapReviewIndex(index: unknown): { schema_version: number; repository_identity: string; runs: ReviewRunSummary[] };
export function mapInteractionPacket(packet: unknown): InteractionPacket;
export function fetchReviewIndex(connection: ReviewConnection, signal?: AbortSignal): Promise<{ schema_version: number; repository_identity: string; runs: ReviewRunSummary[] }>;
export function fetchProjectDeclarationReview(connection: ReviewConnection, signal?: AbortSignal): Promise<unknown>;
export function fetchVerificationReview(connection: ReviewConnection, signal?: AbortSignal): Promise<unknown>;
export function fetchReviewScorecard(connection: ReviewConnection, scorecardUrl: string, signal?: AbortSignal): Promise<unknown>;
export function fetchReviewInteraction(connection: ReviewConnection, interactionUrl: string, signal?: AbortSignal): Promise<InteractionPacket>;
export function fetchCapabilityAuthorizations(connection: ReviewConnection, capabilitiesUrl: string, signal?: AbortSignal): Promise<unknown>;
