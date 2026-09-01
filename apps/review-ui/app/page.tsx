'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  GitBranch,
  FileCode2,
  Fingerprint,
  MoreHorizontal,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import fixtureDocument from '@/data/review-scorecard.json';
import {
  fetchCapabilityAuthorizations,
  fetchProjectDeclarationReview,
  fetchReviewIndex,
  fetchReviewInteraction,
  fetchReviewScorecard,
  fetchVerificationReview,
  parseReviewConnection,
  POLL_INTERVAL_MS,
  selectRunId,
  type ReviewConnection,
} from '@/lib/review-client.mjs';

type Widen<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T extends Array<infer Item> ? Array<Widen<Item>> : T extends object ? { [Key in keyof T]: Widen<T[Key]> } : T;
type ReviewScorecard = Widen<typeof fixtureDocument>;
type ReviewCriterion = ReviewScorecard['criteria'][number];
type ReviewBlocker = ReviewScorecard['exceptions'][number];
type ReviewRunSummary = {
  run_id: string;
  title: string;
  state: string;
  updated_at: string;
  head_sha: string;
  verdict: string;
  proof_score: number;
  blocking_count: number;
  scorecard_url: string;
  interaction_url?: string;
  capabilities_url?: string;
};
type ReviewRunIndex = { schema_version: number; repository_identity: string; runs: ReviewRunSummary[] };
type InteractionItem = { id: string; text: string; confidence: 'confirmed' | 'verify'; severity: 'info' | 'warning' | 'blocking'; source_refs: string[] };
type InteractionPacket = {
  schema_version: number;
  id: string;
  run_id: string;
  kind: 'alignment-brief' | 'decision-queue' | 'progress-pulse' | 'delivery-brief';
  title: string;
  verdict: 'informational' | 'action-required' | 'ready' | 'blocked' | 'failed';
  summary: string;
  attention: { required: boolean; count: number; reasons: string[] };
  sections: Array<{ id: string; title: string; items: InteractionItem[] }>;
  actions: Array<{ id: string; label: string; kind: string; recommended: boolean }>;
  source_artifacts: Array<{ id: string; kind: string; sha256: string }>;
  compression: { source_artifact_count: number; surfaced_item_count: number; omitted_item_count: number };
};
type CapabilityRequest = {
  id: string;
  capability: string;
  operation: string;
  target: string;
  scope: string[];
  reason: string;
  risk: 'low' | 'medium' | 'high';
  authority: string;
  decision: string;
};
type CapabilityAuthorization = {
  request: CapabilityRequest;
  subject_sha256: string;
  status: 'unrequested' | 'pending' | 'approved' | 'rejected' | 'expired' | 'stale';
  approval_request_id?: string;
  approval_receipt_id?: string;
  expires_at?: string;
};
type CapabilityAuthorizationView = {
  schema_version: number;
  run_id: string;
  head_sha: string;
  counts: { total: number; unrequested: number; pending: number; approved: number; rejected: number; expired: number; stale: number };
  capabilities: CapabilityAuthorization[];
  next_action: string;
};
type ProjectDeclarationReview = {
  schema_version: number;
  id: string;
  repository_identity: string;
  head_sha: string;
  proposal_sha256: string;
  verdict: 'blocked' | 'review-required';
  approval_available: boolean;
  structural_coverage: number;
  counts: { commands: number; launch_commands: number; configured_services: number; verification_jobs: number; service_bound_verifications: number; blockers: number };
  dimensions: Array<{ id: string; label: string; earned: number; possible: number; status: 'covered' | 'partial' | 'missing' }>;
  execution_surfaces: Array<{ id: string; kind: 'launch' | 'verify'; run: string; source: string; status: 'mapped' | 'unmapped' }>;
  blockers: Array<{ code: string; subject: string; summary: string }>;
  decision?: { id: string; title: string; question: string; reason: string; evidence_refs: string[]; required_fields: string[] };
  next_action: string;
};
type VerificationSummary = {
  id: string;
  goal_run_id?: string;
  commit_sha: string;
  current_revision: boolean;
  command: { id: string; kind: 'build' | 'test' | 'lint' | 'typecheck' | 'verify' };
  started_at: string;
  completed_at: string;
  duration_ms: number;
  outcome: { status: 'pass' | 'fail' | 'blocked'; reason: string; summary: string };
  readiness: { status: 'pass' | 'fail' | 'not-required'; passed: number; total: number };
  workspace_clean: boolean;
  teardown_status: 'pass' | 'fail' | 'not_required';
  artifact_count: number;
  achieved_evidence_level: 'E0' | 'E2';
};
type VerificationReview = {
  schema_version: number;
  repository_identity: string;
  current_head_sha: string;
  counts: { total: number; pass: number; fail: number; blocked: number; current: number; stale: number };
  latest: VerificationSummary | null;
  verifications: VerificationSummary[];
};

type ReviewSelection =
  | { kind: 'criterion'; item: ReviewCriterion }
  | { kind: 'blocker'; item: ReviewBlocker };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isRunIndex(value: unknown): value is ReviewRunIndex {
  return isRecord(value) && value.schema_version === 1 && Array.isArray(value.runs) && value.runs.every((run) =>
    isRecord(run) && typeof run.run_id === 'string' && typeof run.scorecard_url === 'string'
  );
}

function isScorecard(value: unknown): value is ReviewScorecard {
  return isRecord(value) && value.schema_version === 1 && typeof value.run_id === 'string' &&
    isRecord(value.proof_coverage) && Array.isArray(value.criteria) && Array.isArray(value.exceptions);
}

function isInteractionPacket(value: unknown): value is InteractionPacket {
  return isRecord(value) && value.schema_version === 1 && typeof value.run_id === 'string' &&
    typeof value.kind === 'string' && typeof value.title === 'string' && Array.isArray(value.sections) &&
    Array.isArray(value.actions) && Array.isArray(value.source_artifacts) && isRecord(value.compression);
}

function isCapabilityAuthorizationView(value: unknown): value is CapabilityAuthorizationView {
  return isRecord(value) && value.schema_version === 1 && typeof value.run_id === 'string' &&
    isRecord(value.counts) && Array.isArray(value.capabilities) && typeof value.next_action === 'string';
}

function isProjectDeclarationReview(value: unknown): value is ProjectDeclarationReview {
  return isRecord(value) && value.schema_version === 1 && typeof value.repository_identity === 'string' &&
    typeof value.head_sha === 'string' && typeof value.structural_coverage === 'number' &&
    isRecord(value.counts) && Array.isArray(value.dimensions) && Array.isArray(value.blockers) &&
    Array.isArray(value.execution_surfaces) && typeof value.next_action === 'string';
}

function isVerificationReview(value: unknown): value is VerificationReview {
  return isRecord(value) && value.schema_version === 1 && typeof value.repository_identity === 'string' &&
    typeof value.current_head_sha === 'string' && isRecord(value.counts) &&
    Array.isArray(value.verifications) && (value.latest === null || isRecord(value.latest));
}

function capabilityStatusClass(status: CapabilityAuthorization['status']) {
  if (status === 'approved') return 'bg-[#dcece3] text-[#286044] hover:bg-[#dcece3]';
  if (status === 'pending') return 'bg-[#f0e4c8] text-[#705920] hover:bg-[#f0e4c8]';
  if (status === 'unrequested') return 'bg-[#e8ebea] text-[#59635f] hover:bg-[#e8ebea]';
  return 'bg-[#f4d8d2] text-[#8c2f25] hover:bg-[#f4d8d2]';
}

function ProjectDeclarationPanel({ review }: { review: ProjectDeclarationReview | null }) {
  if (!review) return null;
  return (
    <section className="mb-6 border border-[#d9dedb] bg-white shadow-[0_1px_2px_rgba(22,36,31,0.04)]">
      <div className="bg-[#f7f9f7] px-6 py-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-[#303936]">Project declaration</p>
              <Badge className={review.verdict === 'review-required' ? 'rounded-md bg-[#dcece3] text-[#286044] hover:bg-[#dcece3]' : 'rounded-md bg-[#f4d8d2] text-[#8c2f25] hover:bg-[#f4d8d2]'}>
                {review.verdict === 'review-required' ? 'REVIEW REQUIRED' : 'BLOCKED'}
              </Badge>
              <span className="font-mono text-xs text-[#66706c]">{review.structural_coverage}/100 structural coverage</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#68726e]">This score measures whether the declaration is structurally complete. It is not runtime proof.</p>
            {review.decision ? (
              <div className="mt-4 border border-[#e6c9c2] bg-[#fff8f6] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#963c31]">One decision needed</p>
                <p className="mt-2 text-sm font-semibold text-[#4c3530]">{review.decision.question}</p>
                <p className="mt-1 text-xs leading-5 text-[#75615c]">{review.decision.reason}</p>
                <p className="mt-2 font-mono text-[10px] text-[#927d77]">Evidence: {review.decision.evidence_refs.join(', ') || 'none'}</p>
              </div>
            ) : null}
          </div>
          <div className="grid w-full min-w-0 grid-cols-3 gap-px border border-[#dce1de] bg-[#dce1de] xl:min-w-[420px] xl:w-auto">
            {[
              ['Commands', review.counts.commands],
              ['Services mapped', `${review.counts.configured_services}/${review.counts.launch_commands}`],
              ['Verifications bound', `${review.counts.service_bound_verifications}/${review.counts.verification_jobs}`],
            ].map(([label, value]) => (
              <div key={label} className="bg-white px-4 py-3 text-center">
                <p className="font-mono text-lg font-semibold text-[#303936]">{value}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.05em] text-[#87908c]">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {review.dimensions.map((item) => (
            <div key={item.id} className="border border-[#dfe4e1] bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-[#59635f]">{item.label}</span>
                <span className="font-mono text-[10px] text-[#7b8581]">{item.earned}/{item.possible}</span>
              </div>
              <Progress value={Math.round(100 * item.earned / item.possible)} className="mt-2 [&_[data-slot=progress-indicator]]:bg-[#527363] [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-[#e9eeeb]" />
            </div>
          ))}
        </div>
        {review.execution_surfaces.length > 0 ? (
          <div className="mt-4 grid gap-2 lg:grid-cols-2">
            {review.execution_surfaces.map((surface) => (
              <article key={surface.id} className="min-w-0 border border-[#dfe4e1] bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-[#39443f]">{surface.id}</p>
                  <Badge variant="outline" className="rounded-md text-[10px] uppercase">{surface.status}</Badge>
                </div>
                <code className="mt-2 block overflow-x-auto whitespace-nowrap bg-[#f5f7f5] px-2 py-1.5 text-[10px] text-[#4e5a55]">{surface.run}</code>
                <p className="mt-2 text-[10px] text-[#87908c]">Source: {surface.source}</p>
              </article>
            ))}
          </div>
        ) : null}
        {review.blockers.length > 0 ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {review.blockers.slice(0, 4).map((blocker) => (
              <div key={`${blocker.code}-${blocker.subject}`} className="flex items-start gap-2 border border-[#eadbd7] bg-white px-3 py-2.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#ad463a]" />
                <p className="text-xs leading-5 text-[#665854]"><strong>{blocker.subject}</strong> · {blocker.summary}</p>
              </div>
            ))}
            {review.blockers.length > 4 ? <p className="px-1 text-xs text-[#7c817f]">+ {review.blockers.length - 4} lower-priority declaration blockers</p> : null}
          </div>
        ) : null}
        <p className="mt-4 border-t border-[#e1e5e2] pt-3 text-xs leading-5 text-[#68726e]">Next: {review.next_action}</p>
      </div>
    </section>
  );
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  if (milliseconds < 60000) return `${Math.round(milliseconds / 1000)} sec`;
  return `${(milliseconds / 60000).toFixed(1)} min`;
}

function VerificationPanel({ review }: { review: VerificationReview | null }) {
  if (!review) return null;
  const latest = review.latest;
  return (
    <section className="mb-6 border border-[#d9dedb] bg-white shadow-[0_1px_2px_rgba(22,36,31,0.04)]">
      <div className="flex flex-col gap-4 border-b border-[#e6e9e7] px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[#303936]">Runtime verification</p>
            <Badge className={!latest ? 'rounded-md bg-[#e8ebea] text-[#59635f] hover:bg-[#e8ebea]' : latest.outcome.status === 'pass' ? 'rounded-md bg-[#dcece3] text-[#286044] hover:bg-[#dcece3]' : 'rounded-md bg-[#f4d8d2] text-[#8c2f25] hover:bg-[#f4d8d2]'}>
              {!latest ? 'NOT RUN' : latest.outcome.status.toUpperCase()}
            </Badge>
            {latest ? <span className="font-mono text-xs text-[#66706c]">{latest.achieved_evidence_level} trusted evidence</span> : null}
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-[#68726e]">
            {latest ? latest.outcome.summary : 'No intact verification receipt exists for this repository yet.'}
          </p>
          {latest ? <p className="mt-2 font-mono text-[10px] text-[#8a938f]">{latest.id} · {latest.command.id} · {formatDuration(latest.duration_ms)}</p> : null}
        </div>
        <div className="grid min-w-[320px] grid-cols-4 gap-px border border-[#dce1de] bg-[#dce1de]">
          {[
            ['Runs', review.counts.total],
            ['Passed', review.counts.pass],
            ['Failed', review.counts.fail + review.counts.blocked],
            ['Stale', review.counts.stale],
          ].map(([label, value]) => (
            <div key={label} className="bg-white px-3 py-3 text-center">
              <p className="font-mono text-lg font-semibold text-[#303936]">{value}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.05em] text-[#87908c]">{label}</p>
            </div>
          ))}
        </div>
      </div>
      {review.verifications.length > 0 ? (
        <div className="divide-y divide-[#edf0ee]">
          {review.verifications.slice(0, 5).map((item) => (
            <article key={item.id} className="grid gap-3 px-6 py-3 text-xs md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
              <div className="min-w-0">
                <p className="truncate font-medium text-[#39443f]">{item.command.id}</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-[#8a938f]">{item.goal_run_id ?? 'legacy unbound run'} · {item.id}</p>
              </div>
              <span className="text-[#68726e]">{item.readiness.passed}/{item.readiness.total} ready · cleanup {item.teardown_status}</span>
              <span className="font-mono text-[#68726e]">{formatDuration(item.duration_ms)}</span>
              <Badge variant="outline" className={item.outcome.status === 'pass' ? 'rounded-md border-[#cfe0d6] text-[#31694f]' : 'rounded-md border-[#e5c9c4] text-[#963c31]'}>
                {item.current_revision ? item.outcome.reason : 'stale'}
              </Badge>
            </article>
          ))}
        </div>
      ) : null}
      <p className="border-t border-[#edf0ee] bg-[#fafbf9] px-6 py-3 text-[11px] leading-5 text-[#7b8480]">E2 means a sealed command/system result. Direct browser, network and database proof still require E3 capture.</p>
    </section>
  );
}

export default function Home() {
  const [scorecard, setScorecard] = useState<ReviewScorecard>(fixtureDocument as ReviewScorecard);
  const [interaction, setInteraction] = useState<InteractionPacket | null>(null);
  const [capabilityView, setCapabilityView] = useState<CapabilityAuthorizationView | null>(null);
  const [declarationReview, setDeclarationReview] = useState<ProjectDeclarationReview | null>(null);
  const [verificationReview, setVerificationReview] = useState<VerificationReview | null>(null);
  const [connection, setConnection] = useState<ReviewConnection | null>(null);
  const [runs, setRuns] = useState<ReviewRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [sourceState, setSourceState] = useState<'sample' | 'connecting' | 'runtime' | 'offline'>('sample');
  const [sourceMessage, setSourceMessage] = useState('No live Goal Run connected.');
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [replayMessage, setReplayMessage] = useState('');

  const scoreDimensions = scorecard.proof_coverage.dimensions;
  const blockers = scorecard.exceptions.filter((item) => item.severity === 'blocking');
  const criteria = scorecard.criteria;
  const isReady = scorecard.verdict === 'ready';

  useEffect(() => {
    const parsed = parseReviewConnection(window.location.hash);
    if (!parsed) return;
    const scheduled = window.setTimeout(() => {
      setConnection(parsed);
      setSourceState('connecting');
      setSourceMessage('Connecting to local Goal Run storage…');
    }, 0);
    return () => window.clearTimeout(scheduled);
  }, []);

  useEffect(() => {
    if (!connection) return;
    const controller = new AbortController();
    let active = true;

    const refresh = async () => {
      try {
        const rawIndex = await fetchReviewIndex(connection, controller.signal);
        if (!isRunIndex(rawIndex)) throw new Error('The review index has an invalid shape.');
        if (!active) return;
        const rawDeclaration = await fetchProjectDeclarationReview(connection, controller.signal);
        if (!isProjectDeclarationReview(rawDeclaration)) throw new Error('The project declaration review has an invalid shape.');
        if (rawDeclaration.repository_identity !== rawIndex.repository_identity) throw new Error('The project declaration belongs to another repository.');
        const rawVerifications = await fetchVerificationReview(connection, controller.signal);
        if (!isVerificationReview(rawVerifications) || rawVerifications.repository_identity !== rawIndex.repository_identity) throw new Error('The verification review has an invalid shape.');
        setDeclarationReview(rawDeclaration);
        setVerificationReview(rawVerifications);
        setRuns(rawIndex.runs);
        const runId = selectRunId(rawIndex.runs, selectedRunId);
        if (!runId) {
          setSourceState('runtime');
          setSourceMessage('Connected. No Goal Runs have been created for this repository.');
          return;
        }
        if (runId !== selectedRunId) setSelectedRunId(runId);
        const summary = rawIndex.runs.find((run) => run.run_id === runId);
        if (!summary) throw new Error('Selected Goal Run is missing from the index.');
        const rawScorecard = await fetchReviewScorecard(connection, summary.scorecard_url, controller.signal);
        if (!isScorecard(rawScorecard) || rawScorecard.run_id !== runId) throw new Error('The scorecard does not match the selected Goal Run.');
        let nextInteraction: InteractionPacket | null = null;
        let nextCapabilities: CapabilityAuthorizationView | null = null;
        if (summary.interaction_url) {
          const rawInteraction = await fetchReviewInteraction(connection, summary.interaction_url, controller.signal);
          if (!isInteractionPacket(rawInteraction) || rawInteraction.run_id !== runId) throw new Error('The interaction packet does not match the selected Goal Run.');
          nextInteraction = rawInteraction;
        }
        if (summary.capabilities_url) {
          const rawCapabilities = await fetchCapabilityAuthorizations(connection, summary.capabilities_url, controller.signal);
          if (!isCapabilityAuthorizationView(rawCapabilities) || rawCapabilities.run_id !== runId) throw new Error('The capability decisions do not match the selected Goal Run.');
          nextCapabilities = rawCapabilities;
        }
        if (!active) return;
        setScorecard(rawScorecard);
        setInteraction(nextInteraction);
        setCapabilityView(nextCapabilities);
        setSelection(null);
        setSourceState('runtime');
        setSourceMessage(`Live Goal Run · refreshed ${new Date().toLocaleTimeString()}`);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setSourceState('offline');
        setSourceMessage(error instanceof Error ? error.message : 'Local Goal Run service is unavailable.');
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [connection, selectedRunId, refreshNonce]);

  useEffect(() => {
    if (!selection) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selection]);

  const focusBlockers = () => {
    document.getElementById('review-blockers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const focusTrace = () => {
    document.getElementById('acceptance-trace')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const requestReplay = () => {
    setReplayMessage('Replay prepared — approval is still blocked until Supervisor isolation is proved.');
    window.setTimeout(() => setReplayMessage(''), 5000);
  };

  const sourceLabel = sourceState === 'runtime' ? 'LIVE RUNTIME' : sourceState === 'connecting' ? 'CONNECTING' : sourceState === 'offline' ? 'RUNTIME OFFLINE' : 'SAMPLE DATA';
  const selectedRun = runs.find((run) => run.run_id === selectedRunId);
  const noLiveRuns = sourceState === 'runtime' && runs.length === 0;

  return (
    <div className="min-h-screen bg-[#f4f5f3] text-[#18201e]">
      <header className="border-b border-[#dfe3df] bg-white">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-lg bg-[#16241f] text-white">
              <TerminalSquare className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-[-0.01em]">DevHarness</span>
                <span className="text-xs text-[#7a827f]">/ Review</span>
              </div>
              <p className="text-[11px] text-[#8b9390]">Goal alignment and evidence review</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="hidden h-7 rounded-md border-[#dce1de] px-2.5 font-mono text-[11px] text-[#58615e] sm:inline-flex">
              <GitBranch data-icon="inline-start" /> {(declarationReview?.head_sha ?? scorecard.head_sha).slice(0, 7)}
            </Badge>
            <div className="relative">
              <Button onClick={() => setRunMenuOpen((open) => !open)} variant="outline" size="sm" className="border-[#d9dedb] bg-white" disabled={noLiveRuns}>
                {noLiveRuns ? 'No Goal Run' : `Run · ${scorecard.run_id.slice(-8)}`} {!noLiveRuns ? <ChevronDown data-icon="inline-end" /> : null}
              </Button>
              {runMenuOpen ? (
                <div className="absolute right-0 top-10 z-30 w-80 border border-[#d9dedb] bg-white p-1.5 shadow-xl">
                  {runs.length > 0 ? runs.map((run) => (
                    <button
                      key={run.run_id}
                      onClick={() => { setSelectedRunId(run.run_id); setRunMenuOpen(false); }}
                      className="flex w-full items-start justify-between gap-4 px-3 py-2.5 text-left hover:bg-[#f3f5f3]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[#303936]">{run.title}</span>
                        <span className="mt-0.5 block font-mono text-[11px] text-[#89918e]">{run.run_id} · {run.state}</span>
                      </span>
                      <Badge variant="outline" className="shrink-0 rounded-md text-[10px]">{run.verdict}</Badge>
                    </button>
                  )) : (
                    <p className="px-3 py-3 text-xs leading-5 text-[#747e7a]">Connect a live review service to list Goal Runs.</p>
                  )}
                </div>
              ) : null}
            </div>
            <Badge className={sourceState === 'runtime' ? 'hidden rounded-md bg-[#dcece3] text-[#286044] hover:bg-[#dcece3] md:inline-flex' : sourceState === 'offline' ? 'hidden rounded-md bg-[#f4d8d2] text-[#8c2f25] hover:bg-[#f4d8d2] md:inline-flex' : 'hidden rounded-md bg-[#f0e4c8] text-[#705920] hover:bg-[#f0e4c8] md:inline-flex'}>
              {sourceState === 'runtime' ? <Wifi data-icon="inline-start" /> : sourceState === 'offline' ? <WifiOff data-icon="inline-start" /> : null}{sourceLabel}
            </Badge>
            <Button onClick={() => setRefreshNonce((value) => value + 1)} variant="ghost" size="icon-sm" aria-label="Refresh review data" disabled={!connection}>
              {connection ? <RefreshCw /> : <MoreHorizontal />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8 lg:py-8">
        {!interaction ? <ProjectDeclarationPanel review={declarationReview} /> : null}
        <VerificationPanel review={verificationReview} />
        {interaction ? (
          <section className="mb-6 border border-[#d9dedb] bg-white shadow-[0_1px_2px_rgba(22,36,31,0.04)]">
            <div className="flex flex-col gap-5 border-b border-[#e6e9e7] px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge className="rounded-md bg-[#e6ede9] text-[#355c4a] hover:bg-[#e6ede9]">ALIGNMENT BRIEF</Badge>
                  <Badge variant={interaction.verdict === 'ready' ? 'secondary' : 'destructive'} className="rounded-md">
                    {interaction.verdict.toUpperCase()}
                  </Badge>
                  <span className="font-mono text-[11px] text-[#89918e]">{interaction.id}</span>
                </div>
                <h1 className="text-xl font-semibold tracking-[-0.025em] text-[#27302d]">{interaction.title}</h1>
                <p className="mt-2 text-sm leading-6 text-[#68726e]">{interaction.summary}</p>
              </div>
              <div className="min-w-[250px] border border-[#ead4cf] bg-[#fff8f6] p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#a64135]" />
                  <div>
                    <p className="text-sm font-semibold text-[#6f3029]">
                      {interaction.actions.some((action) => action.kind === 'approve') ? 'Scope decision required' : 'Scope approval unavailable'}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#80645f]">
                      {interaction.actions.find((action) => action.recommended)?.label ?? 'Inspect the current checkpoint.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid divide-y divide-[#ecefed] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
              {interaction.sections.map((section) => (
                <article key={section.id} className="px-5 py-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#79827e]">{section.title}</p>
                  <div className="space-y-3">
                    {section.items.map((item) => (
                      <div key={item.id} className="flex items-start gap-2.5">
                        {item.severity === 'blocking' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#ad463a]" /> : item.confidence === 'confirmed' ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#39745a]" /> : <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-[#8b7660]" />}
                        <div>
                          <p className="text-xs leading-5 text-[#4f5955]">{item.text}</p>
                          <p className="mt-1 font-mono text-[10px] uppercase text-[#969e9a]">{item.confidence} · {item.source_refs.join(', ')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <ProjectDeclarationPanel review={declarationReview} />
            {capabilityView ? (
              <div className="border-t border-[#e6e9e7] bg-[#fbfcfb] px-6 py-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[#303936]">Capability decisions</p>
                      <Badge className="rounded-md bg-[#e8ebea] text-[#59635f] hover:bg-[#e8ebea]">{capabilityView.counts.total} total</Badge>
                      {capabilityView.counts.approved > 0 ? <Badge className="rounded-md bg-[#dcece3] text-[#286044] hover:bg-[#dcece3]">{capabilityView.counts.approved} approved</Badge> : null}
                      {capabilityView.counts.pending > 0 ? <Badge className="rounded-md bg-[#f0e4c8] text-[#705920] hover:bg-[#f0e4c8]">{capabilityView.counts.pending} pending</Badge> : null}
                      {capabilityView.counts.unrequested > 0 ? <Badge variant="outline" className="rounded-md">{capabilityView.counts.unrequested} unrequested</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#747e7a]">Only an approved, current signed receipt grants authority. This page cannot approve.</p>
                  </div>
                  <div className="max-w-xl border border-[#dce1de] bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#87908c]">Next action</p>
                    <code className="mt-1 block break-all text-xs leading-5 text-[#39443f]">{capabilityView.next_action}</code>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {capabilityView.capabilities.map((item) => (
                    <article key={item.request.id} className="border border-[#dfe4e1] bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[#303936]">{item.request.id}</p>
                          <p className="mt-0.5 font-mono text-[10px] uppercase text-[#909995]">{item.request.capability}</p>
                        </div>
                        <Badge className={`rounded-md uppercase ${capabilityStatusClass(item.status)}`}>{item.status}</Badge>
                      </div>
                      <dl className="mt-3 space-y-2 text-xs leading-5">
                        <div><dt className="inline font-semibold text-[#717b77]">Operation · </dt><dd className="inline text-[#4d5753]">{item.request.operation}</dd></div>
                        <div><dt className="inline font-semibold text-[#717b77]">Target · </dt><dd className="inline text-[#4d5753]">{item.request.target}</dd></div>
                        <div><dt className="inline font-semibold text-[#717b77]">Scope · </dt><dd className="inline text-[#4d5753]">{item.request.scope.join(', ')}</dd></div>
                        <div><dt className="inline font-semibold text-[#717b77]">Risk · </dt><dd className="inline text-[#4d5753]">{item.request.risk} · {item.request.authority}</dd></div>
                      </dl>
                      <p className="mt-3 border-t border-[#edf0ee] pt-3 text-xs leading-5 text-[#68726e]">{item.request.reason}</p>
                      <p className="mt-2 truncate font-mono text-[10px] text-[#9aa19e]" title={item.subject_sha256}>sha256:{item.subject_sha256}</p>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#e6e9e7] bg-[#fafbf9] px-6 py-3 text-[11px] text-[#7b8480]">
              <span>{interaction.compression.source_artifact_count} hashed source artifacts</span>
              <span>{interaction.compression.surfaced_item_count} surfaced items</span>
              <span>{interaction.compression.omitted_item_count} lower-priority details compressed</span>
              <span>{scorecard.proof_coverage.score}/100 current proof coverage</span>
              <span>{scorecard.exception_counts.blocking} blocking gaps</span>
              <span className="ml-auto font-medium text-[#5b6762]">Run state: {selectedRun?.state ?? 'unknown'}</span>
            </div>
          </section>
        ) : null}
        {noLiveRuns ? (
          <section className="border border-dashed border-[#cfd6d2] bg-[#f8faf8] px-6 py-5 text-sm text-[#68726e]">
            <p className="font-semibold text-[#46514d]">No Goal Run has started</p>
            <p className="mt-1 leading-6">This is the project-configuration checkpoint. Review and accept the declaration above before DevHarness can bind future goals to a clean repository revision.</p>
          </section>
        ) : interaction?.kind !== 'alignment-brief' ? <>
        <section className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.65fr)]">
          <div className={isReady ? 'relative overflow-hidden border border-[#c9ddd1] bg-[#f8fcf9] p-6 shadow-[0_1px_2px_rgba(22,36,31,0.04)] lg:p-7' : 'relative overflow-hidden border border-[#e3c9c4] bg-[#fffaf9] p-6 shadow-[0_1px_2px_rgba(22,36,31,0.04)] lg:p-7'}>
            <div className={isReady ? 'absolute inset-y-0 left-0 w-1 bg-[#39745a]' : 'absolute inset-y-0 left-0 w-1 bg-[#b54839]'} />
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 flex items-center gap-2">
                  <Badge className={isReady ? 'h-6 rounded-md bg-[#dcece3] px-2.5 font-semibold text-[#286044] hover:bg-[#dcece3]' : 'h-6 rounded-md bg-[#f4d8d2] px-2.5 font-semibold text-[#8c2f25] hover:bg-[#f4d8d2]'}>
                    {isReady ? <CheckCircle2 data-icon="inline-start" /> : <AlertTriangle data-icon="inline-start" />} {scorecard.verdict.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-[#786c69]">{scorecard.exception_counts.blocking} blocking failures</span>
                </div>
                <h1 className="text-balance text-2xl font-semibold tracking-[-0.035em] text-[#251f1d] lg:text-[30px]">
                  {scorecard.title}
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#6d6461]">
                  {scorecard.summary}
                </p>
              </div>
              <div className="flex min-w-[160px] items-end gap-2 sm:flex-col sm:text-right">
                <span className="font-mono text-4xl font-semibold tracking-[-0.05em] text-[#372e2a]">{scorecard.proof_coverage.score}</span>
                <span className="pb-1 text-xs text-[#887b76] sm:pb-0">proof coverage / 100</span>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#ebd9d5] pt-5">
              <Button onClick={scorecard.exception_counts.blocking > 0 ? focusBlockers : focusTrace} className={isReady ? 'bg-[#356a50] px-3 text-white hover:bg-[#29573f]' : 'bg-[#a53d31] px-3 text-white hover:bg-[#8c3026]'}>
                {scorecard.exception_counts.blocking > 0 ? `Review ${scorecard.exception_counts.blocking} blockers` : 'Review delivery evidence'} <ArrowRight data-icon="inline-end" />
              </Button>
              <Button onClick={focusTrace} variant="outline" className="border-[#dfcac5] bg-white text-[#554743]">
                View acceptance trace
              </Button>
              <span className="ml-auto hidden text-xs text-[#8d817d] md:block">{sourceMessage}{selectedRun ? ` · ${selectedRun.state}` : ''}</span>
            </div>
          </div>

          <div className="border border-[#dfe4e1] bg-white p-5 shadow-[0_1px_2px_rgba(22,36,31,0.04)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Proof coverage</p>
                <p className="mt-0.5 text-xs text-[#7b8481]">Counted from revision-bound artifacts</p>
              </div>
              <ShieldCheck className="size-5 text-[#4f6f62]" />
            </div>
            <div className="space-y-3.5">
              {scoreDimensions.map((item) => (
                <div key={item.label}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-[#4c5652]">{item.label}</span>
                    <span className="font-mono text-[#7b8481]">{item.proved} / {item.applicable} · {item.weighted_score} / {item.weight}</span>
                  </div>
                  <Progress value={item.applicable === 0 ? 0 : Math.round(100 * item.proved / item.applicable)} className="[&_[data-slot=progress-indicator]]:bg-[#527363] [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-[#e9eeeb]" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
          <div id="review-blockers" className="scroll-mt-6 border border-[#e3dedb] bg-white shadow-[0_1px_2px_rgba(22,36,31,0.04)]">
            <div className="flex items-start justify-between border-b border-[#ebe8e5] px-5 py-4">
              <div>
                <p className="text-sm font-semibold">Requires attention</p>
                <p className="mt-0.5 text-xs text-[#7c817f]">Only exceptions that can change the decision</p>
              </div>
              <Badge variant="destructive" className="rounded-md">{scorecard.exception_counts.blocking} blocking</Badge>
            </div>
            <div className="divide-y divide-[#efedeb]">
              {blockers.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <CheckCircle2 className="mx-auto size-5 text-[#39745a]" />
                  <p className="mt-2 text-sm font-medium text-[#34403b]">No blocking exceptions</p>
                  <p className="mt-1 text-xs text-[#7c8582]">Inspect the acceptance evidence before delivery approval.</p>
                </div>
              ) : blockers.map((blocker) => (
                <article key={blocker.id} className="group px-5 py-5 transition-colors hover:bg-[#fdf9f8]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-[#f8e9e6] text-[#a33d31]">
                      <AlertTriangle className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-[#9b392e]">{blocker.id}</span>
                        <span className="text-[11px] text-[#9a928f]">Affects {blocker.affected_outcome}</span>
                      </div>
                      <h2 className="mt-1 text-sm font-semibold text-[#342d2a]">{blocker.title}</h2>
                      <p className="mt-1 text-xs leading-5 text-[#756d69]">{blocker.detail}</p>
                      <button onClick={() => setSelection({ kind: 'blocker', item: blocker })} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#8f362c] hover:underline">
                        Inspect evidence <ArrowRight className="size-3" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div id="acceptance-trace" className="scroll-mt-6 border border-[#dfe4e1] bg-white shadow-[0_1px_2px_rgba(22,36,31,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8ece9] px-5 py-4">
              <div>
                <p className="text-sm font-semibold">Acceptance criteria</p>
                <p className="mt-0.5 text-xs text-[#7c8582]">{scorecard.acceptance_counts.pass} passed · {scorecard.acceptance_counts.blocked} blocked · {scorecard.integrity.omitted_item_count} hidden</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="rounded-md border-[#dce3df] text-[#52605b]">MUST only</Badge>
                <Button onClick={requestReplay} variant="outline" size="sm" className="border-[#dce3df]">
                  <Play data-icon="inline-start" /> Replay selected
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-[#f8f9f7] text-[11px] uppercase tracking-[0.06em] text-[#7f8884]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Criterion</th>
                    <th className="px-4 py-3 font-medium">Required</th>
                    <th className="px-4 py-3 font-medium">Proof</th>
                    <th className="px-4 py-3 font-medium">Verdict</th>
                    <th className="w-10 px-3 py-3"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf0ee]">
                  {criteria.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center">
                        <CircleDashed className="mx-auto size-5 text-[#8b9490]" />
                        <p className="mt-2 text-sm font-medium text-[#46514d]">Acceptance criteria are not defined yet</p>
                        <p className="mt-1 text-xs text-[#7c8582]">They will appear after repository understanding and scope clarification.</p>
                      </td>
                    </tr>
                  ) : criteria.map((criterion) => (
                    <tr key={criterion.id} className="group hover:bg-[#fafbf9]">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          {criterion.status === 'pass' ? (
                            <CheckCircle2 className="size-4 shrink-0 text-[#39745a]" />
                          ) : (
                            <CircleDashed className="size-4 shrink-0 text-[#b14b3e]" />
                          )}
                          <div>
                            <p className="font-medium text-[#303936]">{criterion.title}</p>
                            <p className="mt-0.5 font-mono text-[11px] text-[#8b9490]">{criterion.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-[#59635f]">{criterion.required_evidence_level}</td>
                      <td className="px-4 py-4 text-xs text-[#66706c]">{criterion.proof_summary}</td>
                      <td className="px-4 py-4">
                        <Badge
                          variant={criterion.status === 'pass' ? 'secondary' : 'destructive'}
                          className={criterion.status === 'pass' ? 'rounded-md bg-[#e8f2ec] text-[#31694f]' : 'rounded-md'}
                        >
                          {criterion.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-3 py-4">
                        <button
                          onClick={() => setSelection({ kind: 'criterion', item: criterion })}
                          className="grid size-7 place-items-center rounded-md text-[#a1aaa6] hover:bg-[#edf1ef] hover:text-[#53615b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#668777]"
                          aria-label={`Inspect ${criterion.id}`}
                        >
                          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        </> : (
          <section className="border border-dashed border-[#cfd6d2] bg-[#f8faf8] px-6 py-5 text-sm text-[#68726e]">
            <p className="font-semibold text-[#46514d]">Later phases are locked</p>
            <p className="mt-1 leading-6">Acceptance trace, implementation evidence and delivery review will appear after project understanding and scope approval.</p>
          </section>
        )}
      </main>

      {replayMessage ? (
        <output className="fixed bottom-5 left-1/2 z-40 w-[min(520px,calc(100%-32px))] -translate-x-1/2 border border-[#cfd9d4] bg-[#1e3029] px-4 py-3 text-sm text-white shadow-xl">
          <div className="flex items-center gap-2">
            <Play className="size-4 text-[#acd0be]" />
            <span>{replayMessage}</span>
          </div>
        </output>
      ) : null}

      {selection ? (
        <div className="fixed inset-0 z-50" role="presentation">
          <button
            className="absolute inset-0 bg-black/15 backdrop-blur-[1px]"
            onClick={() => setSelection(null)}
            aria-label="Close evidence details"
          />
          <dialog
            open
            aria-labelledby="evidence-panel-title"
            className="absolute inset-y-0 right-0 m-0 flex h-full w-full max-w-none flex-col border-l border-[#dfe4e1] bg-[#fbfcfa] p-0 shadow-2xl sm:max-w-[520px]"
          >
              <div className="relative border-b border-[#e3e7e4] bg-white px-6 py-5">
                <button
                  onClick={() => setSelection(null)}
                  className="absolute right-4 top-4 grid size-8 place-items-center rounded-md text-[#6b7571] hover:bg-[#eef1ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#668777]"
                  aria-label="Close evidence details"
                >
                  <X className="size-4" />
                </button>
                <div className="mb-2 flex items-center gap-2">
                  <Badge
                    variant={selection.kind === 'blocker' || selection.item.status === 'blocked' ? 'destructive' : 'secondary'}
                    className={selection.kind === 'criterion' && selection.item.status === 'pass' ? 'rounded-md bg-[#e8f2ec] text-[#31694f]' : 'rounded-md'}
                  >
                    {selection.kind === 'blocker' ? 'BLOCKING' : selection.item.status.toUpperCase()}
                  </Badge>
                  <span className="font-mono text-xs text-[#7a8480]">{selection.item.id}</span>
                </div>
                <h2 id="evidence-panel-title" className="pr-8 text-xl font-semibold tracking-[-0.025em]">
                  {selection.item.title}
                </h2>
                <p className="mt-1 text-sm leading-5 text-[#707a76]">
                  {selection.kind === 'blocker' ? selection.item.detail : selection.item.proof_summary}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6">
                {selection.kind === 'criterion' ? (
                  <div className="space-y-7">
                    <section>
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d8783]">Acceptance trace</p>
                      <div className="space-y-0">
                        {[
                          ['Requirement', selection.item.requirement_refs.join(', ') || 'Unmapped'],
                          ['Criterion', `${selection.item.id} · ${selection.item.title}`],
                          ['Task', selection.item.task_refs.join(', ') || 'No task'],
                          ['Change', selection.item.change_refs.join(', ') || 'No change'],
                          ['Evidence', selection.item.evidence_refs.join(', ') || 'No trusted evidence'],
                        ].map(([label, value], index, all) => (
                          <div key={label} className="relative flex gap-3 pb-4">
                            {index < all.length - 1 ? <div className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-[#d7ded9]" /> : null}
                            <div className="relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-[#cfd8d3] bg-white">
                              {index === 4 ? <Fingerprint className="size-3 text-[#4d7562]" /> : <span className="size-1.5 rounded-full bg-[#668777]" />}
                            </div>
                            <div>
                              <p className="text-[11px] text-[#89928e]">{label}</p>
                              <p className="mt-0.5 text-sm font-medium text-[#34403b]">{value}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="border border-[#dfe5e1] bg-white p-4">
                      <div className="flex items-start gap-3">
                        <Network className="mt-0.5 size-4 text-[#567464]" />
                        <div>
                          <p className="text-sm font-semibold">Replay recipe</p>
                          <p className="mt-1 text-xs leading-5 text-[#6f7974]">{selection.item.replay_recipe}</p>
                          <Button onClick={requestReplay} variant="outline" size="sm" className="mt-3 border-[#d8dfdb]">
                            <Play data-icon="inline-start" /> Prepare isolated replay
                          </Button>
                        </div>
                      </div>
                    </section>

                    <section>
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d8783]">Significant change</p>
                      <div className="flex items-center justify-between border border-[#dfe5e1] bg-white px-4 py-3">
                        <div className="flex items-center gap-3">
                          <FileCode2 className="size-4 text-[#65746e]" />
                          <span className="font-mono text-xs text-[#4f5b56]">{selection.item.change_refs.join(', ') || 'No significant change linked'}</span>
                        </div>
                        <ArrowRight className="size-4 text-[#9ba49f]" />
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="border border-[#ead1cc] bg-[#fff8f6] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#9e3d32]">Why this blocks approval</p>
                      <p className="mt-2 text-sm leading-6 text-[#66524d]">
                        {selection.item.detail}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d8783]">Required resolution</p>
                      <ol className="mt-3 space-y-3 text-sm text-[#4c5853]">
                        <li className="flex gap-3"><span className="font-mono text-xs text-[#8a9590]">01</span><span>{selection.item.required_action}</span></li>
                        <li className="flex gap-3"><span className="font-mono text-xs text-[#8a9590]">02</span><span>Run it against revision <strong>{scorecard.head_sha.slice(0, 7)}</strong>.</span></li>
                        <li className="flex gap-3"><span className="font-mono text-xs text-[#8a9590]">03</span><span>Recompute the hard gates and proof coverage.</span></li>
                      </ol>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-auto border-t border-[#e1e6e3] bg-white px-6 py-4">
                <Button disabled className="w-full">
                  Approval unavailable while blocked
                </Button>
              </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
