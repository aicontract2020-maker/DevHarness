import { expect, test } from '@playwright/test';
import fixtureDocument from '../data/review-scorecard.json' with { type: 'json' };

const apiOrigin = process.env.PLAYWRIGHT_API_ORIGIN ?? 'http://127.0.0.1:4317';
const reviewUrl = (mode) => `/#api=${encodeURIComponent(apiOrigin)}&token=${'f'.repeat(64)}&mode=${mode}`;

function clone(value) {
  return structuredClone(value);
}

function makeScorecard(mode) {
  const scorecard = clone(fixtureDocument);
  if (mode === 'ready') {
    scorecard.title = 'Ready to ship';
    scorecard.summary = 'The brief is fully understood, the evidence is clean, and the repository is ready for autonomous work.';
    scorecard.verdict = 'ready';
    scorecard.proof_coverage.score = 98;
    scorecard.acceptance_counts.pass = scorecard.acceptance_counts.total;
    scorecard.acceptance_counts.blocked = 0;
    scorecard.exception_counts.blocking = 0;
    scorecard.integrity.trusted_context = true;
    scorecard.integrity.omitted_item_count = 4;
    scorecard.criteria = scorecard.criteria.map((criterion) => ({
      ...criterion,
      status: 'pass',
      proof_summary: `${criterion.title} is verified in the browser fixture.`
    }));
  } else {
    scorecard.title = 'Question remains before delivery';
    scorecard.summary = 'The developer still needs one answer before the goal can be treated as fully understood.';
    scorecard.verdict = 'blocked';
    scorecard.proof_coverage.score = 61;
    scorecard.acceptance_counts.pass = Math.max(0, scorecard.acceptance_counts.pass - 1);
    scorecard.acceptance_counts.blocked = 1;
    scorecard.exception_counts.blocking = 2;
    scorecard.integrity.trusted_context = false;
    scorecard.criteria = scorecard.criteria.map((criterion, index) => ({
      ...criterion,
      status: index === 0 ? 'blocked' : 'pass',
      proof_summary: index === 0
        ? 'The browser fixture exposes an unresolved decision.'
        : `${criterion.title} remains verified in the browser fixture.`
    }));
  }

  return scorecard;
}

function makeInteraction(mode) {
  const runId = mode === 'ready' ? 'run-ready' : 'run-question';
  const kind = mode === 'ready' ? 'delivery-brief' : 'decision-queue';
  return {
    schema_version: 1,
    id: `${runId}-interaction`,
    run_id: runId,
    kind,
    generated_at: '2026-09-02T12:00:00Z',
    head_sha: mode === 'ready' ? 'ready1234567890abcdef1234567890abcdef1234' : 'quest1234567890abcdef1234567890abcdef1234',
    title: mode === 'ready' ? 'Ready brief' : 'Question brief',
    verdict: mode === 'ready' ? 'ready' : 'action-required',
    summary: mode === 'ready'
      ? 'The project is understood well enough to proceed without extra clarification.'
      : 'The goal still has one open decision that should be resolved before execution continues.',
    attention: {
      required: mode !== 'ready',
      count: mode === 'ready' ? 0 : 1,
      reasons: mode === 'ready' ? [] : ['One scope decision is still open.']
    },
    sections: mode === 'ready' ? [
      {
        id: 'alignment-outcome',
        title: 'Outcome',
        items: [
          {
            id: 'outcome-1',
            text: 'Build the autonomous review flow without mixing it into the consumer project.',
            confidence: 'confirmed',
            severity: 'info',
            source_refs: ['scorecard:AC-01'],
            metrics: { known_claims: 4, total_claims: 4, unknown_claims: 0, conflict_claims: 0 }
          }
        ]
      },
      {
        id: 'alignment-understanding',
        title: 'Understanding',
        items: [
          {
            id: 'understanding-1',
            text: 'The browser fixture verified the goal, the repo shape, and the review surface.',
            confidence: 'confirmed',
            severity: 'info',
            source_refs: ['scorecard:AC-02']
          }
        ]
      },
      {
        id: 'alignment-boundaries',
        title: 'Boundaries',
        items: [
          {
            id: 'boundaries-1',
            text: 'Consumer code stays separate from harness code.',
            confidence: 'confirmed',
            severity: 'info',
            source_refs: ['scorecard:AC-03']
          }
        ]
      },
      {
        id: 'alignment-criteria',
        title: 'Criteria',
        items: [
          {
            id: 'criteria-1',
            text: 'The review page should be readable, traceable, and browser-verifiable.',
            confidence: 'confirmed',
            severity: 'info',
            source_refs: ['scorecard:AC-04']
          }
        ]
      }
    ] : [
      {
        id: 'alignment-outcome',
        title: 'Outcome',
        items: [
          {
            id: 'outcome-1',
            text: 'The agent still needs one clarification before it can proceed independently.',
            confidence: 'verify',
            severity: 'warning',
            source_refs: ['scorecard:AC-01'],
            metrics: { known_claims: 2, total_claims: 4, unknown_claims: 2, conflict_claims: 0 }
          }
        ]
      },
      {
        id: 'alignment-understanding',
        title: 'Understanding',
        items: [
          {
            id: 'understanding-1',
            text: 'The browser fixture can render the scorecard, but one decision remains open.',
            confidence: 'verify',
            severity: 'warning',
            source_refs: ['scorecard:AC-02']
          }
        ]
      },
      {
        id: 'alignment-boundaries',
        title: 'Boundaries',
        items: [
          {
            id: 'boundaries-1',
            text: 'Review and approval are still separate from delivery.',
            confidence: 'confirmed',
            severity: 'info',
            source_refs: ['scorecard:AC-03']
          }
        ]
      },
      {
        id: 'alignment-criteria',
        title: 'Criteria',
        items: [
          {
            id: 'criteria-1',
            text: 'The page must stay readable even when the brief is blocked.',
            confidence: 'confirmed',
            severity: 'info',
            source_refs: ['scorecard:AC-04']
          }
        ]
      },
      {
        id: 'alignment-questions',
        title: 'Questions',
        items: [
          {
            id: 'questions-1',
            text: 'Should the agent proceed with the default architecture or wait for one more answer?',
            confidence: 'verify',
            severity: 'blocking',
            source_refs: ['scorecard:AC-05']
          }
        ]
      }
    ],
    actions: [
      {
        id: 'action-1',
        label: mode === 'ready' ? 'Proceed to delivery' : 'Resolve the open decision',
        kind: mode === 'ready' ? 'ship' : 'clarify',
        recommended: true
      }
    ],
    source_artifacts: [
      { id: 'artifact-1', kind: 'scorecard', sha256: 'a'.repeat(64), uri: 'secret://scorecard' },
      { id: 'artifact-2', kind: 'brief', sha256: 'b'.repeat(64), uri: 'secret://brief' }
    ],
    traceability: [
      { item_id: 'outcome-1', source_refs: ['artifact-1', 'artifact-2'] },
      { item_id: 'criteria-1', source_refs: ['artifact-1'] }
    ],
    decisions: mode === 'ready' ? [] : [
      {
        id: 'decision-1',
        question: 'Should the team standardize the new brief before shipping?',
        why_now: 'The goal is blocked on a single execution choice.',
        impact: 'It affects the next implementation step.',
        reversibility: 'Low',
        recommended_option_id: 'option-a',
        options: [
          {
            id: 'option-a',
            label: 'Standardize now',
            outcome: 'The goal can proceed with one consistent contract.',
            tradeoffs: ['Requires one more developer approval']
          },
          {
            id: 'option-b',
            label: 'Defer the choice',
            outcome: 'The goal stays blocked until the decision is revisited.',
            tradeoffs: ['Delays delivery']
          }
        ]
      }
    ],
    compression: {
      source_artifact_count: 2,
      surfaced_item_count: mode === 'ready' ? 4 : 5,
      omitted_item_count: mode === 'ready' ? 1 : 2
    }
  };
}

function makeIndex(mode) {
  const runId = mode === 'ready' ? 'run-ready' : 'run-question';
  return {
    schema_version: 1,
    repository_identity: 'review-ui-fixture',
    runs: [
      {
        run_id: runId,
        title: mode === 'ready' ? 'Ready run' : 'Question run',
        state: 'running',
        updated_at: '2026-09-02T12:00:00Z',
        head_sha: mode === 'ready' ? 'ready1234567890abcdef1234567890abcdef1234' : 'quest1234567890abcdef1234567890abcdef1234',
        verdict: mode === 'ready' ? 'ready' : 'blocked',
        proof_score: mode === 'ready' ? 98 : 61,
        blocking_count: mode === 'ready' ? 0 : 1,
        scorecard_url: `/api/review/runs/${runId}/scorecard`,
        interaction_url: `/api/review/runs/${runId}/interaction`,
        capabilities_url: `/api/review/runs/${runId}/capabilities`
      }
    ]
  };
}

function makeCapabilityView(mode) {
  return {
    schema_version: 1,
    run_id: mode === 'ready' ? 'run-ready' : 'run-question',
    head_sha: mode === 'ready' ? 'ready1234567890abcdef1234567890abcdef1234' : 'quest1234567890abcdef1234567890abcdef1234',
    counts: {
      total: 1,
      unrequested: 0,
      pending: mode === 'ready' ? 0 : 1,
      approved: mode === 'ready' ? 1 : 0,
      rejected: 0,
      expired: 0,
      stale: 0
    },
    capabilities: [
      {
        request: {
          id: 'cap-1',
          capability: 'review-brief',
          operation: 'inspect',
          target: 'alignment brief',
          scope: ['project', 'goal run'],
          reason: 'The developer should be able to inspect the live brief.',
          risk: 'low',
          authority: 'developer',
          decision: mode === 'ready' ? 'approved' : 'pending'
        },
        subject_sha256: 'c'.repeat(64),
        status: mode === 'ready' ? 'approved' : 'pending',
        approval_request_id: 'approval-1',
        approval_receipt_id: mode === 'ready' ? 'receipt-1' : undefined,
        expires_at: '2026-12-31T00:00:00Z'
      }
    ],
    research_tasks: [
      {
        id: 'research-1',
        topic_id: 'topic-1',
        query: 'Best practices for autonomous developer review pages',
        owner: 'reviewer',
        priority: 1,
        approval_capability: 'review-brief',
        status: mode === 'ready' ? 'approved' : 'pending-approval',
        expected_outcome: 'A concise checklist the developer can trust quickly.',
        basis: ['scorecard', 'brief'],
        approval_request_id: 'approval-2',
        approval_receipt_id: mode === 'ready' ? 'receipt-2' : null
      }
    ],
    research_task_counts: {
      total: 1,
      pending_approval: mode === 'ready' ? 0 : 1,
      approved: mode === 'ready' ? 1 : 0,
      blocked: 0
    },
    next_action: mode === 'ready' ? 'Proceed with the next goal.' : 'Approve the open clarification before proceeding.'
  };
}

async function routeReviewApi(page, mode) {
  await page.route('**/api/review/**', async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    let body;

    if (pathname === '/api/review/runs') {
      body = makeIndex(mode);
    } else if (pathname.endsWith('/scorecard')) {
      body = makeScorecard(mode);
    } else if (pathname.endsWith('/interaction')) {
      body = makeInteraction(mode);
    } else if (pathname.endsWith('/capabilities')) {
      body = makeCapabilityView(mode);
    } else if (pathname === '/api/review/project-declaration') {
      body = {
        schema_version: 1,
        id: 'project-declaration-1',
        repository_identity: 'review-ui-fixture',
        head_sha: mode === 'ready' ? 'ready1234567890abcdef1234567890abcdef1234' : 'quest1234567890abcdef1234567890abcdef1234',
        proposal_sha256: 'd'.repeat(64),
        verdict: 'review-required',
        approval_available: true,
        structural_coverage: mode === 'ready' ? 91 : 73,
        summary: {
          total_claims: 12,
          proved_claims: mode === 'ready' ? 11 : 8,
          unresolved_claims: mode === 'ready' ? 1 : 3,
          conflict_claims: 0,
          priority_domains: ['database', 'frontend', 'backend'],
          domain_knownness: {
            database: {
              total_claims: 4,
              known_claims: mode === 'ready' ? 4 : 3,
              unknown_claims: mode === 'ready' ? 0 : 1,
              conflict_claims: 0,
              subdomains: {
                schema: { total_claims: 2, known_claims: 2, unknown_claims: 0, conflict_claims: 0 },
                migrations: { total_claims: 2, known_claims: mode === 'ready' ? 2 : 1, unknown_claims: mode === 'ready' ? 0 : 1, conflict_claims: 0 }
              }
            },
            frontend: {
              total_claims: 4,
              known_claims: mode === 'ready' ? 4 : 2,
              unknown_claims: mode === 'ready' ? 0 : 2,
              conflict_claims: 0,
              subdomains: {
                routes: { total_claims: 2, known_claims: 2, unknown_claims: 0, conflict_claims: 0 },
                state: { total_claims: 2, known_claims: mode === 'ready' ? 2 : 0, unknown_claims: mode === 'ready' ? 0 : 2, conflict_claims: 0 }
              }
            },
            backend: {
              total_claims: 4,
              known_claims: mode === 'ready' ? 3 : 2,
              unknown_claims: mode === 'ready' ? 1 : 2,
              conflict_claims: 0,
              subdomains: {
                api: { total_claims: 2, known_claims: 2, unknown_claims: 0, conflict_claims: 0 },
                jobs: { total_claims: 2, known_claims: mode === 'ready' ? 1 : 0, unknown_claims: mode === 'ready' ? 1 : 2, conflict_claims: 0 }
              }
            }
          }
        },
        counts: {
          commands: 4,
          launch_commands: 2,
          configured_services: 2,
          verification_jobs: 2,
          service_bound_verifications: 2,
          blockers: mode === 'ready' ? 0 : 2
        },
        dimensions: [
          { id: 'project-setup', label: 'Project setup', earned: 2, possible: 2, status: 'covered' },
          { id: 'understanding', label: 'Repository understanding', earned: 2, possible: 2, status: mode === 'ready' ? 'covered' : 'partial' },
          { id: 'verification', label: 'Verification', earned: mode === 'ready' ? 2 : 1, possible: 2, status: mode === 'ready' ? 'covered' : 'partial' }
        ],
        execution_surfaces: [
          { id: 'browser', kind: 'launch', run: 'npm run dev', source: 'detected:browser', status: 'mapped' },
          { id: 'review', kind: 'verify', run: 'npm run test:e2e', source: 'fixture', status: 'mapped' }
        ],
        blockers: mode === 'ready' ? [] : [
          { code: 'DECISION-OPEN', subject: 'Alignment brief', summary: 'One question remains unresolved.' }
        ],
        next_action: mode === 'ready' ? 'Continue with the next goal.' : 'Resolve the open decision and re-run the brief.'
      };
    } else if (pathname === '/api/review/verifications') {
      body = {
        schema_version: 1,
        repository_identity: 'review-ui-fixture',
        current_head_sha: mode === 'ready' ? 'ready1234567890abcdef1234567890abcdef1234' : 'quest1234567890abcdef1234567890abcdef1234',
        counts: { total: 1, pass: mode === 'ready' ? 1 : 0, fail: mode === 'ready' ? 0 : 1, blocked: 0, current: 1, stale: 0 },
        latest: {
          id: 'verification-1',
          goal_run_id: mode === 'ready' ? 'run-ready' : 'run-question',
          commit_sha: mode === 'ready' ? 'ready1234567890abcdef1234567890abcdef1234' : 'quest1234567890abcdef1234567890abcdef1234',
          current_revision: true,
          command: { id: 'web-playwright', kind: 'verify' },
          started_at: '2026-09-02T11:55:00Z',
          completed_at: '2026-09-02T11:56:00Z',
          duration_ms: 60_000,
          outcome: {
            status: mode === 'ready' ? 'pass' : 'fail',
            reason: mode === 'ready' ? 'Browser proof passed.' : 'One decision remains unresolved.',
            summary: mode === 'ready' ? 'Real browser verification passed.' : 'Real browser verification is blocked.'
          },
          readiness: { status: mode === 'ready' ? 'pass' : 'fail', passed: mode === 'ready' ? 2 : 1, total: 2 },
          workspace_clean: true,
          teardown_status: 'pass',
          artifact_count: 2,
          achieved_evidence_level: mode === 'ready' ? 'E2' : 'E0'
        },
        verifications: []
      };
    } else {
      await route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }), contentType: 'application/json' });
      return;
    }

    await route.fulfill({ status: 200, body: JSON.stringify(body), contentType: 'application/json' });
  });
}

async function openReviewPage(page, mode) {
  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    if (!request.url().includes('/favicon.ico')) failedRequests.push(`${request.method()} ${request.url()}`);
  });

  await routeReviewApi(page, mode);
  await page.goto(reviewUrl(mode));
  await expect(page.getByRole('heading', { name: mode === 'ready' ? 'Ready to ship' : 'Question remains before delivery' })).toBeVisible();

  return { consoleErrors, failedRequests };
}

test.describe('live alignment review page', () => {
  test('renders the question brief in a real browser', async ({ page }, testInfo) => {
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    const { consoleErrors, failedRequests } = await openReviewPage(page, 'question');

    await expect(page.getByText('Brief highlights')).toBeVisible();
    await expect(page.getByText('Open decisions')).toBeVisible();
    await expect(page.getByText('The agent still needs one clarification before it can proceed independently.')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('question-brief-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: /Question remains before delivery/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('question-brief-mobile.png'), fullPage: true });

    await expect(page.getByRole('button', { name: 'View acceptance trace' })).toBeVisible();
    await page.getByRole('button', { name: 'View acceptance trace' }).click();
    await expect(page.locator('#acceptance-trace')).toBeInViewport();

    await expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    await expect(failedRequests, failedRequests.join('\n')).toEqual([]);

    await page.context().tracing.stop({ path: testInfo.outputPath('question-brief-trace.zip') });
  });

  test('renders the ready brief with no hidden secrets', async ({ page }, testInfo) => {
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    const { consoleErrors, failedRequests } = await openReviewPage(page, 'ready');

    await expect(page.getByText('Brief highlights')).toBeVisible();
    await expect(page.getByText('Ready to ship')).toBeVisible();
    await expect(page.getByText('Outcome')).toBeVisible();
    await expect(page.getByText('Recommended action is surfaced above')).toBeVisible();
    await expect(page.locator('text=secret://')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('ready-brief-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('Ready to ship')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('ready-brief-mobile.png'), fullPage: true });

    await expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    await expect(failedRequests, failedRequests.join('\n')).toEqual([]);

    await page.context().tracing.stop({ path: testInfo.outputPath('ready-brief-trace.zip') });
  });
});
