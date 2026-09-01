export const POLL_INTERVAL_MS: 5000;

export type ReviewConnection = { apiOrigin: string; token: string };
export type ReviewRunSummary = { run_id: string; scorecard_url: string; interaction_url?: string; capabilities_url?: string; [key: string]: unknown };

export function parseReviewConnection(hash: string): ReviewConnection | null;
export function selectRunId(runs: ReviewRunSummary[], currentRunId: string | null): string | null;
export function fetchReviewIndex(connection: ReviewConnection, signal?: AbortSignal): Promise<unknown>;
export function fetchProjectDeclarationReview(connection: ReviewConnection, signal?: AbortSignal): Promise<unknown>;
export function fetchVerificationReview(connection: ReviewConnection, signal?: AbortSignal): Promise<unknown>;
export function fetchReviewScorecard(connection: ReviewConnection, scorecardUrl: string, signal?: AbortSignal): Promise<unknown>;
export function fetchReviewInteraction(connection: ReviewConnection, interactionUrl: string, signal?: AbortSignal): Promise<unknown>;
export function fetchCapabilityAuthorizations(connection: ReviewConnection, capabilitiesUrl: string, signal?: AbortSignal): Promise<unknown>;
