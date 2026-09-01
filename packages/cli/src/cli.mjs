#!/usr/bin/env node

import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createInitialGoalRun } from "../../core/src/goal-run.mjs";
import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { evaluateVerificationExecutionAuthority } from "../../core/src/execution-authority.mjs";
import { discoverRepository } from "../../project/src/discover.mjs";
import { readProjectConfig, readProjectConfigFile } from "../../project/src/config.mjs";
import { evaluateReadiness, formatReadinessReport } from "../../project/src/doctor.mjs";
import { initializeProject, proposeProjectConfig } from "../../project/src/init.mjs";
import { createProjectDeclarationReview } from "../../project/src/project-declaration-review.mjs";
import { compileProjectHarness, formatProjectHarness } from "../../project/src/harness.mjs";
import { createOnboardingPlan, formatRepositoryUnderstandingBrief } from "../../project/src/onboard.mjs";
import { createGoalUnderstandingCheckpoint } from "../../project/src/alignment.mjs";
import { resolveExternalDataRoot } from "../../project/src/path-policy.mjs";
import { defaultDataRoot, defaultSupervisorRoot, onboardingPlanPath, projectHarnessPath, writeOnboardingPlan, writeProjectHarness } from "../../runtime/src/data-store.mjs";
import { issueCommandSystemEvidence, issueCommandTestEvidence } from "../../runtime/src/supervisor-evidence.mjs";
import { createSupervisorApprovalRequest, recordInteractiveApprovalDecision } from "../../runtime/src/supervisor-approval.mjs";
import { initializeSupervisorIdentity } from "../../runtime/src/supervisor-store.mjs";
import { loadCapabilityAuthorizationView, requestCapabilityAuthorization, resolveCapabilityApprovalContext } from "../../runtime/src/capability-authorization.mjs";
import { createVerificationPlan, executeVerificationPlan, formatVerificationPlan } from "../../runtime/src/verify.mjs";
import { appendGoalRunCheckpoint, createStoredGoalRun, loadGoalRun, loadRunScorecard } from "../../runtime/src/goal-run-store.mjs";
import { startReviewServer } from "../../runtime/src/review-server.mjs";

const HELP = `DevHarness

Usage:
  devharness onboard [--repo PATH] [--config PATH] [--write] [--format text|json]
  devharness init [--repo PATH] [--write] [--format text|json]
  devharness doctor [--repo PATH] [--config PATH] [--format text|json]
  devharness build [--repo PATH] [--config PATH] [--write] [--format text|json]
  devharness supervisor-init [--format text|json]
  devharness request-approval --run ID --gate GATE --subject ID --subject-sha SHA [--repo PATH]
  devharness request-capability --run ID --capability ID [--repo PATH] [--data-dir PATH]
  devharness approve --request ID [--repo PATH] [--data-dir PATH]
  devharness verify --command ID [--repo PATH] [--config PATH] [--data-dir PATH] [--run ID --execute] [--attest] [--timeout-seconds N] [--format text|json]
  devharness goal --goal TEXT [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness advance --run ID [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness status --run ID [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness review [--repo PATH] [--config PATH] [--data-dir PATH] [--port N] [--ui-origin URL]

Commands:
  onboard   Produce a read-only understanding and bounded capability plan. --write stores it externally.
  init      Inspect a repository and propose devharness.yaml. Does not write unless --write is present.
  doctor    Produce a read-only deterministic autonomous-development readiness report.
  build     Compile the accepted project declaration. Does not write unless --write is present.
  supervisor-init  Create or load the fixed external signing identity. Never exposes its private key.
  request-approval Create a signed, revision-bound pending request; this does not approve it.
  request-capability Request exactly one bounded capability from the current Alignment Brief.
  approve    Record a decision only through an exact foreground TTY confirmation. JSON and pipes are refused; independent human authentication is pending.
  verify    Plan an isolated command. Execution requires a Goal Run and its current signed capabilities.
  goal      Create a durable Goal Run at the current committed revision. Does not execute an agent.
  advance   Perform the next safe Goal Run step. v0 records static understanding only.
  status    Restore one Goal Run from its event stream and show a compact current verdict.
  review    Start a token-protected, read-only loopback service for the developer review page.
`;

function parseArguments(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", repo: process.cwd(), format: "text", write: false, execute: false };
  }
  const options = {
    command: argv[0],
    repo: process.cwd(),
    format: "text",
    write: false,
    execute: false,
    attest: false,
    commandId: null,
    goal: null,
    runId: null,
    gate: null,
    subjectId: null,
    subjectSha256: null,
    requestId: null,
    capabilityId: null,
    configPath: null,
    expiresInMinutes: 60,
    timeoutMs: 10 * 60 * 1000,
    port: 4317,
    uiOrigin: "http://localhost:3000",
    dataRoot: defaultDataRoot()
  };

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      options.write = true;
    } else if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--attest") {
      options.attest = true;
    } else if (argument === "--command") {
      options.commandId = argv[++index];
      if (!options.commandId) throw new Error("--command requires a configured command id");
    } else if (argument === "--goal") {
      options.goal = argv[++index];
      if (!options.goal?.trim()) throw new Error("--goal requires a non-empty outcome");
    } else if (argument === "--run") {
      options.runId = argv[++index];
      if (!options.runId) throw new Error("--run requires a run id");
    } else if (argument === "--gate") {
      options.gate = argv[++index];
      if (!options.gate) throw new Error("--gate requires a gate name");
    } else if (argument === "--subject") {
      options.subjectId = argv[++index];
      if (!options.subjectId) throw new Error("--subject requires an artifact id");
    } else if (argument === "--subject-sha") {
      options.subjectSha256 = argv[++index];
      if (!options.subjectSha256) throw new Error("--subject-sha requires a canonical SHA-256 hash");
    } else if (argument === "--request") {
      options.requestId = argv[++index];
      if (!options.requestId) throw new Error("--request requires an approval request id");
    } else if (argument === "--capability") {
      options.capabilityId = argv[++index];
      if (!options.capabilityId) throw new Error("--capability requires a capability id");
    } else if (argument === "--expires-minutes") {
      options.expiresInMinutes = Number(argv[++index]);
      if (!Number.isInteger(options.expiresInMinutes)) throw new Error("--expires-minutes requires an integer");
    } else if (argument === "--timeout-seconds") {
      const seconds = Number(argv[++index]);
      if (!Number.isInteger(seconds)) throw new Error("--timeout-seconds requires an integer");
      options.timeoutMs = seconds * 1000;
    } else if (argument === "--port") {
      options.port = Number(argv[++index]);
      if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("--port requires an integer from 1024 to 65535");
    } else if (argument === "--ui-origin") {
      const value = argv[++index];
      if (!value) throw new Error("--ui-origin requires an HTTP origin");
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== value) throw new Error("--ui-origin must be an exact HTTP origin without a path");
      options.uiOrigin = parsed.origin;
    } else if (argument === "--data-dir") {
      options.dataRoot = argv[++index];
      if (!options.dataRoot) throw new Error("--data-dir requires a path");
    } else if (argument === "--repo") {
      options.repo = argv[++index];
      if (!options.repo) throw new Error("--repo requires a path");
    } else if (argument === "--config") {
      options.configPath = argv[++index];
      if (!options.configPath) throw new Error("--config requires a path");
    } else if (argument === "--format") {
      options.format = argv[++index];
      if (!options.format) throw new Error("--format requires text or json");
    } else if (argument === "--help" || argument === "-h") {
      options.command = "help";
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!['text', 'json'].includes(options.format)) {
    throw new Error("--format must be text or json");
  }
  return options;
}

async function loadConfiguredProject(snapshot, options) {
  const repositoryRoot = fileURLToPath(snapshot.repository.root_uri);
  if (!options.configPath) {
    return { ...(await readProjectConfig(repositoryRoot)), source: "tracked" };
  }
  const loaded = await readProjectConfigFile(options.configPath);
  const relative = path.relative(repositoryRoot, loaded.path);
  const insideRepository = relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
  if (insideRepository) {
    throw new Error("--config must point outside the consumer repository so local testing cannot modify project files.");
  }
  return { ...loaded, source: "external" };
}

function nextRunAction(run) {
  if (run.state === "received") return "Understand the repository and define falsifiable acceptance criteria.";
  if (run.state === "clarifying") return "Review the Alignment Brief, then authorize the missing proof capabilities before scope definition.";
  if (run.state === "awaiting_scope_approval") return "Review the Alignment Brief and decide the scope gate.";
  if (run.state === "awaiting_delivery_approval") return "Review the Delivery Brief and decide the delivery gate.";
  if (["completed", "blocked", "cancelled"].includes(run.state)) return "Inspect the final verdict and its evidence.";
  return "Continue the governed Goal Run from its recorded state.";
}

export function formatVerificationExecutionResult({ receipt, receiptPath, evidence = null, attestation, format = "text" }) {
  const result = {
    receipt,
    evidence_manifest: evidence?.manifest ?? null,
    attestation
  };
  if (format === "json") return JSON.stringify(result, null, 2);
  const lines = [
    `${receipt.outcome.status.toUpperCase()}: ${receipt.outcome.summary}`,
    `Receipt: ${receiptPath}`
  ];
  if (evidence) {
    lines.push(`Supervisor evidence: ${evidence.manifest.id}`);
    lines.push(`Issuer: ${evidence.manifest.issuer.fingerprint}`);
  } else if (attestation?.status === "not-issued") {
    lines.push(`Passing evidence: not issued (${attestation.summary})`);
  }
  return lines.join("\n");
}

function initialScorecard(run, generatedAt) {
  const scopeHash = createHash("sha256").update(JSON.stringify({ goal: run.goal.original, scope_version: 1 })).digest("hex");
  return createReviewScorecard({
    run,
    scopeHash,
    harnessVersion: "unbound",
    title: `Goal received: ${run.goal.original}`,
    reviewVerdicts: [],
    reviewChecks: [],
    findings: [],
    unknowns: [
      { id: "understanding-missing", title: "Repository understanding not proved", summary: "The Goal Run has not completed revision-bound system understanding." },
      { id: "acceptance-missing", title: "Acceptance criteria not defined", summary: "The Goal Run has not defined falsifiable acceptance criteria." },
      { id: "harness-unbound", title: "Project harness not bound", summary: "No accepted project harness is bound to this Goal Run." }
    ],
    sourceArtifactCount: 2,
    generatedAt,
    dataSource: "runtime"
  });
}

export async function runCli(argv, io = console, services = {}) {
  const options = parseArguments(argv);
  if (!options.command || options.command === "help") {
    io.log(HELP);
    return 0;
  }

  if (!["onboard", "init", "doctor", "build", "supervisor-init", "request-approval", "request-capability", "approve", "verify", "goal", "advance", "status", "review"].includes(options.command)) {
    throw new Error(`Unknown command: ${options.command}`);
  }

  if (options.command === "supervisor-init") {
    const result = await initializeSupervisorIdentity(defaultSupervisorRoot());
    const summary = {
      created: result.created,
      id: result.identity.id,
      fingerprint: result.identity.fingerprint,
      algorithm: result.identity.algorithm
    };
    io.log(options.format === "json" ? JSON.stringify(summary, null, 2) : `Supervisor ${result.created ? "created" : "loaded"}: ${summary.id}\nFingerprint: ${summary.fingerprint}\nAlgorithm: ${summary.algorithm}`);
    return 0;
  }

  const snapshot = await discoverRepository(options.repo);

  if (options.command === "goal") {
    if (!options.goal?.trim()) throw new Error("goal requires --goal TEXT");
    if (!snapshot.repository.git.is_repository || !snapshot.repository.git.head_sha || snapshot.repository.git.dirty) {
      throw new Error("Goal Runs require a clean committed Git repository baseline.");
    }
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const now = services.now?.() ?? new Date().toISOString();
    const { run, event } = createInitialGoalRun({
      id: services.newRunId?.() ?? `run-${randomUUID()}`,
      repository: {
        identity: snapshot.repository.identity,
        root_uri: snapshot.repository.root_uri,
        base_ref: snapshot.repository.git.branch ?? snapshot.repository.git.head_sha
      },
      originalGoal: options.goal,
      headSha: snapshot.repository.git.head_sha,
      now
    });
    const scorecard = initialScorecard(run, now);
    const stored = await createStoredGoalRun({ dataRoot, run, event, scorecard });
    const result = { run, scorecard, path: stored.paths.runRoot, next_action: nextRunAction(run) };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Goal Run created: ${run.id}\nState: ${run.state}\nRevision: ${run.current_head_sha.slice(0, 12)}\nReview: ${scorecard.verdict} (${scorecard.exception_counts.blocking} blocking)\nNext: ${result.next_action}\nStored externally: ${stored.paths.runRoot}`);
    return 0;
  }

  if (options.command === "status") {
    if (!options.runId) throw new Error("status requires --run ID");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const run = await loadGoalRun(dataRoot, snapshot.repository.identity, options.runId);
    const scorecard = await loadRunScorecard(dataRoot, snapshot.repository.identity, options.runId);
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    const capabilities = run.state === "clarifying"
      ? await loadCapabilityAuthorizationView({ dataRoot, supervisorRoot, repositoryIdentity: snapshot.repository.identity, runId: options.runId, now: new Date(services.now?.() ?? Date.now()) })
      : null;
    const result = { run, scorecard, ...(capabilities ? { capabilities } : {}), next_action: capabilities?.next_action ?? nextRunAction(run) };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Goal Run: ${run.id}\nGoal: ${run.goal.refined ?? run.goal.original}\nState: ${run.state}\nRevision: ${run.current_head_sha.slice(0, 12)}\nReview: ${scorecard.verdict} · proof ${scorecard.proof_coverage.score}/100 · ${scorecard.exception_counts.blocking} blocking${capabilities ? `\nCapabilities: ${capabilities.counts.approved} approved · ${capabilities.counts.pending} pending · ${capabilities.counts.unrequested} unrequested · ${capabilities.counts.rejected + capabilities.counts.expired + capabilities.counts.stale} blocked` : ""}\nNext: ${result.next_action}`);
    return scorecard.verdict === "ready" ? 0 : 2;
  }

  if (options.command === "advance") {
    if (!options.runId) throw new Error("advance requires --run ID");
    if (!snapshot.repository.git.is_repository || !snapshot.repository.git.head_sha || snapshot.repository.git.dirty) {
      throw new Error("Goal Run advance requires a clean committed Git repository baseline.");
    }
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const currentRun = await loadGoalRun(dataRoot, snapshot.repository.identity, options.runId);
    if (currentRun.state !== "received") throw new Error("Static understanding can advance only a received Goal Run.");
    if (currentRun.repository.identity !== snapshot.repository.identity) throw new Error("Goal Run belongs to a different repository.");
    if (currentRun.current_head_sha !== snapshot.repository.git.head_sha) throw new Error("Repository revision changed after Goal Run intake.");
    let config = null;
    let configError = null;
    let configSource = options.configPath ? "external" : "tracked";
    try {
      ({ config, source: configSource } = await loadConfiguredProject(snapshot, options));
    } catch (error) {
      configError = error.message;
    }
    const generatedAt = services.now?.() ?? new Date().toISOString();
    const trustContext = await loadTrustedEvaluationContext({ snapshot });
    const report = evaluateReadiness(snapshot, { trustContext, config, configError, configSource });
    const onboardingPlan = await createOnboardingPlan(snapshot, { report, config, configError, configSource, generatedAt });
    const checkpoint = await createGoalUnderstandingCheckpoint({ run: currentRun, snapshot, onboardingPlan, generatedAt });
    const scorecard = createReviewScorecard({
      run: checkpoint.run,
      scopeHash: createHash("sha256").update(JSON.stringify({ goal: currentRun.goal.original, scope_version: currentRun.goal.scope_version })).digest("hex"),
      harnessVersion: "unbound",
      title: `Understanding checkpoint: ${currentRun.goal.original}`,
      reviewVerdicts: [],
      reviewChecks: [],
      findings: [],
      unknowns: [
        ...onboardingPlan.blockers.slice(0, 5).map((blocker) => ({ id: blocker.id, title: "Understanding proof missing", summary: blocker.summary, source_refs: ["artifact-onboarding-plan"] })),
        { id: "acceptance-missing", title: "Acceptance criteria not defined", summary: "Falsifiable acceptance criteria and non-goals are not yet defined.", source_refs: ["artifact-goal-input"] }
      ],
      sourceArtifactCount: checkpoint.artifacts.length,
      omittedItemCount: checkpoint.packet.compression.omitted_item_count,
      generatedAt,
      dataSource: "runtime"
    });
    const stored = await appendGoalRunCheckpoint({
      dataRoot,
      repositoryIdentity: snapshot.repository.identity,
      runId: currentRun.id,
      events: checkpoint.events,
      nextRun: checkpoint.run,
      scorecard,
      packet: checkpoint.packet,
      artifacts: checkpoint.artifacts
    });
    const result = { run: checkpoint.run, interaction: checkpoint.packet, scorecard, path: stored.paths.checkpoint, next_action: nextRunAction(checkpoint.run) };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Goal Run advanced: ${checkpoint.run.id}\nState: ${checkpoint.run.state}\nAlignment: ${checkpoint.packet.verdict}\nScope approval: unavailable\nMissing proof: ${onboardingPlan.blockers.length}\nNext: ${result.next_action}\nStored externally: ${stored.paths.checkpoint}`);
    return checkpoint.packet.verdict === "ready" ? 0 : 2;
  }

  if (options.command === "review") {
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const start = services.startReviewServer ?? startReviewServer;
    let declarationConfig;
    if (options.configPath) {
      declarationConfig = (await loadConfiguredProject(snapshot, options)).config;
    } else {
      declarationConfig = proposeProjectConfig(snapshot);
    }
    if (!options.configPath && !snapshot.repository.git.dirty) {
      try {
        declarationConfig = (await readProjectConfig(fileURLToPath(snapshot.repository.root_uri))).config;
      } catch (error) {
        if (!error.message.startsWith("No devharness.yaml exists.")) throw error;
      }
    }
    const declarationReview = await createProjectDeclarationReview(snapshot, declarationConfig);
    const live = await start({ dataRoot, repositoryIdentity: snapshot.repository.identity, declarationReview, port: options.port, allowedOrigin: options.uiOrigin });
    const reviewUrl = `${options.uiOrigin}/#api=${encodeURIComponent(live.origin)}&token=${live.token}`;
    io.log(options.format === "json"
      ? JSON.stringify({ api_origin: live.origin, review_url: reviewUrl, repository_identity: snapshot.repository.identity }, null, 2)
      : `Review service: ${live.origin}\nRepository: ${snapshot.repository.identity}\nOpen: ${reviewUrl}\nRead-only. Keep this process running while reviewing.`);
    return 0;
  }

  if (options.command === "request-approval") {
    if (!options.runId || !options.gate || !options.subjectId || !options.subjectSha256) {
      throw new Error("request-approval requires --run, --gate, --subject and --subject-sha");
    }
    if (!snapshot.repository.git.head_sha || snapshot.repository.git.dirty) {
      throw new Error("Approval requests require a clean committed repository revision.");
    }
    if (options.gate === "capability") throw new Error("Capability subjects must be derived from the current Goal Run; use request-capability.");
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    await initializeSupervisorIdentity(supervisorRoot);
    const request = await createSupervisorApprovalRequest({
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      relevantHeadSha: snapshot.repository.git.head_sha,
      runId: options.runId,
      gate: options.gate,
      subject: { id: options.subjectId, artifact_sha256: options.subjectSha256 },
      expiresInMinutes: options.expiresInMinutes
    });
    io.log(options.format === "json" ? JSON.stringify({ request }, null, 2) : `Approval requested: ${request.id}\nGate: ${request.gate}\nSubject: ${request.subject.id}\nRevision: ${request.relevant_head_sha}\nIssuer: ${request.attestation.issuer_fingerprint}\nExpires: ${request.expires_at}`);
    return 0;
  }

  if (options.command === "request-capability") {
    if (!options.runId || !options.capabilityId) throw new Error("request-capability requires --run and --capability");
    if (!snapshot.repository.git.head_sha || snapshot.repository.git.dirty) throw new Error("Capability requests require a clean committed repository revision.");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    await initializeSupervisorIdentity(supervisorRoot);
    const result = await requestCapabilityAuthorization({
      dataRoot,
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      runId: options.runId,
      capabilityId: options.capabilityId,
      expiresInMinutes: options.expiresInMinutes,
      now: () => new Date(services.now?.() ?? Date.now())
    });
    io.log(options.format === "json" ? JSON.stringify(result, null, 2) : `Capability approval requested: ${result.capability.id}\nOperation: ${result.capability.operation}\nTarget: ${result.capability.target}\nScope: ${result.capability.scope.join(", ")}\nRisk: ${result.capability.risk}\nRequest: ${result.request.id}\nExpires: ${result.request.expires_at}\nNext: devharness approve --repo ${fileURLToPath(snapshot.repository.root_uri)} --data-dir ${dataRoot} --request ${result.request.id}`);
    return 0;
  }

  if (options.command === "approve") {
    if (!options.requestId) throw new Error("approve requires --request ID");
    if (options.format === "json") throw new Error("Approval is unavailable in JSON mode; use the authenticated foreground TTY.");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    const capability = await resolveCapabilityApprovalContext({ dataRoot, supervisorRoot, repositoryIdentity: snapshot.repository.identity, requestId: options.requestId, now: new Date(services.now?.() ?? Date.now()) });
    const receipt = await recordInteractiveApprovalDecision({
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      requestId: options.requestId,
      capability
    });
    io.log(`Decision recorded: ${receipt.decision}\nReceipt: ${receipt.id}\nIssuer: ${receipt.attestation.issuer_fingerprint}`);
    return receipt.decision === "approved" ? 0 : 2;
  }

  if (options.command === "onboard") {
    if (options.execute) throw new Error("onboard never executes project actions; review its capability plan instead");
    let config = null;
    let configError = null;
    let configSource = options.configPath ? "external" : "tracked";
    try {
      ({ config, source: configSource } = await loadConfiguredProject(snapshot, options));
    } catch (error) {
      configError = error.message;
    }
    const trustContext = snapshot.repository.git.head_sha ? await loadTrustedEvaluationContext({ snapshot }) : undefined;
    const report = evaluateReadiness(snapshot, { trustContext, config, configError, configSource });
    const plan = await createOnboardingPlan(snapshot, { report, config, configError, configSource });
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const targetPath = onboardingPlanPath(dataRoot, snapshot.repository.identity, plan.id);
    const stored = options.write ? await writeOnboardingPlan(targetPath, plan) : { path: targetPath, written: false };
    io.log(options.format === "json" ? JSON.stringify({ snapshot, report, plan, path: stored.path, written: stored.written }, null, 2) : `${formatRepositoryUnderstandingBrief(plan)}\n${stored.written ? `Stored externally: ${stored.path}` : "Dry run only. Add --write to store this plan outside the consumer repository."}`);
    return plan.verdict === "ready" ? 0 : 2;
  }

  if (options.command === "doctor") {
    let config = null;
    let configError = null;
    let configSource = options.configPath ? "external" : "tracked";
    try {
      ({ config, source: configSource } = await loadConfiguredProject(snapshot, options));
    } catch (error) {
      configError = error.message;
    }
    const trustContext = snapshot.repository.git.head_sha ? await loadTrustedEvaluationContext({ snapshot }) : undefined;
    const report = evaluateReadiness(snapshot, { trustContext, config, configError, configSource });
    io.log(options.format === "json" ? JSON.stringify({ snapshot, report }, null, 2) : formatReadinessReport(report));
    return report.overall.verdict === "ready" ? 0 : 2;
  }

  if (options.command === "verify") {
    if (!options.commandId) throw new Error("verify requires --command ID");
    if (options.attest && !options.execute) throw new Error("--attest requires --execute; planned commands cannot become evidence");
    if (options.execute && !options.runId) throw new Error("Public execution requires --run ID so signed capability authority can be verified.");
    const { config } = await loadConfiguredProject(snapshot, options);
    const plan = await createVerificationPlan({
      snapshot,
      config,
      commandId: options.commandId,
      goalRunId: options.runId,
      dataRoot: options.dataRoot,
      timeoutMs: options.timeoutMs
    });
    if (!options.execute) {
      io.log(options.format === "json" ? JSON.stringify({ plan, execute: false }, null, 2) : `${formatVerificationPlan(plan)}\nDry run only. Add --execute to run this approved command.`);
      return 0;
    }
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const authorizationView = await loadCapabilityAuthorizationView({
      dataRoot,
      supervisorRoot: services.supervisorRoot ?? defaultSupervisorRoot(),
      repositoryIdentity: snapshot.repository.identity,
      runId: options.runId,
      now: new Date(services.now?.() ?? Date.now())
    });
    const authority = evaluateVerificationExecutionAuthority(plan, authorizationView);
    if (!authority.allowed) throw new Error(`Verification execution lacks current capability authority: ${authority.reasons.map((reason) => reason.message).join(" ")}`);
    const receipt = await executeVerificationPlan(plan);
    let evidence = null;
    let attestation = { status: "not-requested", reason: null, summary: "No passing evidence was requested." };
    if (options.attest) {
      if (receipt.outcome.status !== "pass") {
        attestation = {
          status: "not-issued",
          reason: "execution-failed",
          summary: "the execution failed; failure receipts remain reviewable but cannot become passing evidence"
        };
      } else if (!["test", "verify"].includes(receipt.command.kind)) {
        attestation = {
          status: "not-issued",
          reason: "sealed-driver-unavailable",
          summary: `no sealed evidence driver is registered for ${receipt.command.kind} receipts`
        };
      } else {
        const supervisorRoot = defaultSupervisorRoot();
        await initializeSupervisorIdentity(supervisorRoot);
        const issueEvidence = receipt.command.kind === "verify" ? issueCommandSystemEvidence : issueCommandTestEvidence;
        evidence = await issueEvidence({
          supervisorRoot,
          receiptRoot: options.dataRoot,
          snapshot,
          config,
          receiptId: receipt.id,
          runId: receipt.goal_run_id ?? options.runId,
          criterion: {
            id: `configured-tests-${receipt.command.id}`,
            claim: `The configured ${receipt.command.id} ${receipt.command.kind === "verify" ? "system verification" : "automated tests"} pass at the current revision.`
          }
        });
        attestation = { status: "issued", reason: null, summary: "Supervisor passing evidence was issued." };
      }
    }
    io.log(formatVerificationExecutionResult({ receipt, receiptPath: plan.paths.receipt, evidence, attestation, format: options.format }));
    if (receipt.outcome.status !== "pass") return 3;
    return options.attest && !evidence ? 4 : 0;
  }

  if (options.command === "build") {
    const { config } = await loadConfiguredProject(snapshot, options);
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const manifest = await compileProjectHarness(snapshot, config);
    const targetPath = projectHarnessPath(dataRoot, snapshot.repository.identity, manifest.id);
    const stored = options.write ? await writeProjectHarness(targetPath, manifest) : { path: targetPath, written: false };
    if (options.format === "json") {
      io.log(JSON.stringify({ manifest, path: stored.path, written: stored.written }, null, 2));
    } else {
      io.log(formatProjectHarness(manifest, stored.path));
      io.log(stored.written ? "Project harness written." : "Dry run only. Review blockers, then add --write to store this external harness.");
    }
    return manifest.blockers.length === 0 ? 0 : 2;
  }

  const result = await initializeProject(snapshot, { write: options.write });
  if (options.format === "json") {
    io.log(JSON.stringify({ config: result.config, path: result.path, written: result.written }, null, 2));
  } else if (result.written) {
    io.log(`Created ${result.path}`);
  } else {
    io.log(result.content);
    io.log("Dry run only. Review this proposal, then add --write to create devharness.yaml.");
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`DevHarness error: ${error.message}`);
    process.exitCode = 1;
  }
}
