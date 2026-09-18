import { hashContract } from "./harness.mjs";
import { isTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";

const SUPPORTED_V0_PLATFORMS = new Set(["web", "api", "cli", "library"]);

function capability({ id, category, weight, status, blocking, summary, evidence = [], remediation = [] }) {
  return { id, category, weight, status, blocking, summary, evidence, remediation };
}

function hasCommand(snapshot, ...kinds) {
  return snapshot.commands.some((command) => kinds.includes(command.kind));
}

function commandHash(command) {
  return hashContract(command);
}

export function receiptMatchesCurrentConfig(snapshot, config, receipt, options = {}) {
  if (!config) return false;
  const expectedCommitSha = options.commitSha ?? snapshot.repository.git.head_sha;
  const configured = config.quality.commands.find((command) => command.id === receipt.command.id);
  if (!configured) return false;
  const resolvedCommand = { ...configured, sha256: commandHash(configured) };
  const harnessConfig = config.harness ?? { services: [], verifications: [] };
  const verificationDeclaration = harnessConfig.verifications.find((item) => item.command_id === configured.id);
  let serviceIds = verificationDeclaration?.service_ids ?? [];
  let expectedWarmup = verificationDeclaration?.warmup ?? [];
  let expectedVerificationHash = hashContract({
    command: resolvedCommand,
    service_ids: serviceIds,
    warmup: expectedWarmup
  });
  // Launch lifecycle plans bind the owned service even when no interactive verification lists it.
  if (configured.kind === "launch") {
    const owned = harnessConfig.services.filter((service) => service.command_id === configured.id);
    if (owned.length !== 1) return false;
    serviceIds = [owned[0].id];
    expectedWarmup = [];
    expectedVerificationHash = hashContract({
      command: resolvedCommand,
      service_ids: serviceIds,
      warmup: expectedWarmup,
      mode: "lifecycle"
    });
  }
  const servicesById = new Map(harnessConfig.services.map((service) => [service.id, service]));
  const expectedServices = serviceIds.map((serviceId) => {
    const service = servicesById.get(serviceId);
    const command = config.quality.commands.find((item) => item.id === service?.command_id);
    if (!service || !command) return null;
    const resolved = {
      id: service.id,
      command: { ...command, sha256: commandHash(command) },
      readiness: service.readiness,
      shutdown: service.shutdown
    };
    return { ...resolved, sha256: hashContract(resolved) };
  });
  return (
      expectedServices.every(Boolean) &&
      receipt.repository_identity === snapshot.repository.identity &&
      receipt.commit_sha === expectedCommitSha &&
      receipt.command.kind === configured.kind &&
      receipt.command.run === configured.run &&
      receipt.command.source === configured.source &&
      receipt.command.sha256 === commandHash(configured) &&
      receipt.harness.config_sha256 === hashContract(config) &&
      receipt.harness.verification_sha256 === expectedVerificationHash &&
      receipt.services.length === expectedServices.length &&
      expectedServices.every((service) => receipt.services.some((record) =>
        record.id === service.id &&
        record.command.sha256 === service.command.sha256 &&
        record.lifecycle_sha256 === service.sha256 &&
        record.readiness.status === "pass" &&
        record.status === "ready" &&
        record.teardown.status === "pass"
      )) &&
      receipt.outcome.status === "pass" &&
      receipt.workspace.isolation === "git-worktree" &&
      receipt.workspace.dirty_before === false &&
      receipt.workspace.dirty_after === false &&
      receipt.teardown.status === "pass"
  );
}

function currentBehaviorEvidence(snapshot, evidence, behaviorReceipt) {
  const current = evidence.filter((record) =>
    record?.run_id === behaviorReceipt?.run_id &&
    Array.isArray(record?.criterion_ids) && record.criterion_ids.length > 0 &&
    record?.subject?.repository_identity === snapshot.repository.identity &&
    record.subject.commit_sha === snapshot.repository.git.head_sha &&
    ["tool", "runtime"].includes(record?.producer?.kind) &&
    ["pass", "observed"].includes(record?.observation?.result) &&
    (record.artifacts ?? []).length > 0
  );
  const requiredTypeGroups = snapshot.detected.platforms.includes("web")
    ? [["browser-snapshot", "screenshot"], ["network"]]
    : snapshot.detected.platforms.includes("api")
      ? [["api-response", "network"]]
      : snapshot.detected.platforms.includes("cli")
        ? [["command-output"], ["filesystem-state"]]
        : [["test-result"]];
  return requiredTypeGroups.every((types) => current.some((record) => types.includes(record.type))) ? current : [];
}

export function currentSupervisorManifest(snapshot, config, trustContext, kind) {
  if (!config || !isTrustedEvaluationContext(trustContext)) return null;
  const configured = new Map(config.quality.commands.map((command) => [command.id, command]));
  return (trustContext.manifests ?? []).find((manifest) => {
    const command = configured.get(manifest.command.id);
    return (
      manifest.repository_identity === snapshot.repository.identity &&
      manifest.commit_sha === snapshot.repository.git.head_sha &&
      manifest.command.kind === kind &&
      command?.kind === kind &&
      manifest.command.sha256 === commandHash(command) &&
      manifest.harness.config_sha256 === hashContract(config) &&
      manifest.outcome.status === "pass"
    );
  }) ?? null;
}

export function commandHasCurrentSupervisorEvidence(snapshot, config, trustContext, command) {
  if (!config || !command?.id || !command?.kind || !isTrustedEvaluationContext(trustContext)) return false;
  return (trustContext.manifests ?? []).some((manifest) =>
    manifest.command?.id === command.id &&
    manifest.repository_identity === snapshot.repository.identity &&
    manifest.commit_sha === snapshot.repository.git.head_sha &&
    manifest.command.kind === command.kind &&
    manifest.command.sha256 === commandHash(command) &&
    manifest.harness.config_sha256 === hashContract(config) &&
    manifest.outcome?.status === "pass"
  );
}

function evaluateEnvironment(snapshot) {
  const environment = snapshot.environment;
  const undocumentedKeys = environment.locally_set_keys.filter((key) => !environment.declared_keys.includes(key));
  if (environment.local_files.length === 0 && environment.example_files.length === 0) {
    return capability({
      id: "environment-contract",
      category: "bootstrap",
      weight: 10,
      status: "not_applicable",
      blocking: false,
      summary: "No environment files were detected."
    });
  }

  if (environment.local_files.length > 0 && !environment.local_files_ignored) {
    return capability({
      id: "environment-contract",
      category: "bootstrap",
      weight: 10,
      status: "fail",
      blocking: true,
      summary: "At least one local environment file is not ignored by Git.",
      evidence: environment.local_files,
      remediation: ["Ignore local environment files and keep only redacted examples in version control."]
    });
  }

  if (environment.local_files.length > 0 && environment.example_files.length === 0) {
    return capability({
      id: "environment-contract",
      category: "bootstrap",
      weight: 10,
      status: "fail",
      blocking: true,
      summary: "Local environment configuration exists without a checked-in example contract.",
      evidence: environment.local_files,
      remediation: ["Add a redacted .env.example that declares every required key without secret values."]
    });
  }

  if (undocumentedKeys.length > 0) {
    return capability({
      id: "environment-contract",
      category: "bootstrap",
      weight: 10,
      status: "fail",
      blocking: true,
      summary: `${undocumentedKeys.length} locally configured key(s) are absent from environment examples.`,
      evidence: undocumentedKeys,
      remediation: ["Declare every required key in a redacted environment example without copying values."]
    });
  }

  return capability({
    id: "environment-contract",
    category: "bootstrap",
    weight: 10,
    status: "pass",
    blocking: true,
    summary: "Environment keys are discoverable without exposing local values.",
    evidence: environment.example_files
  });
}

function evaluateSubmodules(snapshot) {
  if (snapshot.submodules.length === 0) {
    return capability({
      id: "submodules-ready",
      category: "bootstrap",
      weight: 10,
      status: "not_applicable",
      blocking: false,
      summary: "No Git submodules were detected."
    });
  }

  const blocking = snapshot.submodules.filter((submodule) => ["missing", "conflicted", "unknown"].includes(submodule.status));
  if (blocking.length > 0) {
    return capability({
      id: "submodules-ready",
      category: "bootstrap",
      weight: 10,
      status: "fail",
      blocking: true,
      summary: `${blocking.length} submodule(s) are unavailable or conflicted.`,
      evidence: blocking.map((submodule) => `${submodule.path}: ${submodule.status}`),
      remediation: ["Initialize required submodules and verify their pinned commits before running goals."]
    });
  }

  const modified = snapshot.submodules.filter((submodule) => submodule.status === "modified");
  return capability({
    id: "submodules-ready",
    category: "bootstrap",
    weight: 10,
    status: modified.length > 0 ? "warn" : "pass",
    blocking: true,
    summary: modified.length > 0 ? "Submodules are initialized but differ from their pinned commits." : "All submodules are initialized at known commits.",
    evidence: snapshot.submodules.map((submodule) => `${submodule.path}: ${submodule.status}`),
    remediation: modified.length > 0 ? ["Reconcile modified submodules before autonomous work."] : []
  });
}

function readinessLevel(capabilities) {
  const status = new Map(capabilities.map((item) => [item.id, item.status]));
  if (status.get("git-repository") !== "pass") return 0;
  let level = 1;
  if (status.get("build-command") === "pass" && status.get("automated-tests") === "pass") level = 2;
  if (level >= 2 && status.get("behavior-verification") === "pass" && ["pass", "not_applicable"].includes(status.get("service-launch"))) level = 3;
  if (level >= 3 && status.get("ci-feedback") === "pass" && status.get("pull-request-delivery") === "pass") level = 4;
  return level;
}

export function evaluateReadiness(snapshot, { receipts = [], trustContext, config = null, configError = null, configSource = "tracked" } = {}) {
  const supported = snapshot.detected.platforms.some((platform) => SUPPORTED_V0_PLATFORMS.has(platform));
  const hasManifests = snapshot.inventory.manifests.length > 0;
  const configFiles = new Set(["devharness.yaml", "devharness.yml"]);
  const hasTrackedConfig = snapshot.inventory.file_count > 0 && snapshot.detected.agent_files.some((file) => configFiles.has(file));
  const hasConfig = configSource === "external" || hasTrackedConfig;
  const validConfig = hasConfig && config !== null && configError === null;
  const configEvidence = configSource === "external"
    ? ["explicit external project configuration"]
    : snapshot.detected.agent_files.filter((file) => configFiles.has(file));
  const requiresLaunch = snapshot.detected.platforms.some((platform) => platform === "web" || platform === "api" || platform === "desktop" || platform === "mobile");
  const behaviorTool = snapshot.detected.test_tools.some((tool) => ["Playwright", "native-tests"].includes(tool)) || hasCommand(snapshot, "verify");
  // Legacy receipts are integrity records only. Only Supervisor-verified manifests may promote
  // readiness, even if a caller supplies schema-valid receipt objects.
  void receipts;
  const buildReceipt = currentSupervisorManifest(snapshot, config, trustContext, "build");
  const testReceipt = currentSupervisorManifest(snapshot, config, trustContext, "test");
  const behaviorReceipt = currentSupervisorManifest(snapshot, config, trustContext, "verify");
  const behaviorEvidence = currentBehaviorEvidence(snapshot, isTrustedEvaluationContext(trustContext) ? trustContext.evidence : [], behaviorReceipt);
  const behaviorProved = Boolean(behaviorReceipt && behaviorEvidence.length > 0);
  const launchReceipt = currentSupervisorManifest(snapshot, config, trustContext, "launch");

  const capabilities = [
    capability({
      id: "git-repository",
      category: "repository",
      weight: 10,
      status: snapshot.repository.git.is_repository && snapshot.repository.git.head_sha ? "pass" : "fail",
      blocking: true,
      summary: snapshot.repository.git.is_repository && snapshot.repository.git.head_sha ? "Repository identity and revision are available." : snapshot.repository.git.is_repository ? "The Git repository has no baseline commit." : "The target is not a Git repository.",
      evidence: snapshot.repository.git.head_sha ? [snapshot.repository.git.head_sha] : [],
      remediation: snapshot.repository.git.is_repository && snapshot.repository.git.head_sha ? [] : ["Initialize Git if needed and create a baseline commit."]
    }),
    capability({
      id: "clean-baseline",
      category: "repository",
      weight: 5,
      status: !snapshot.repository.git.is_repository ? "not_applicable" : snapshot.repository.git.dirty ? "warn" : "pass",
      blocking: snapshot.repository.git.is_repository,
      summary: !snapshot.repository.git.is_repository ? "A clean baseline requires Git." : snapshot.repository.git.dirty ? `${snapshot.repository.git.changed_file_count} local change(s) are outside the committed baseline.` : "The requested repository has a clean committed baseline.",
      evidence: snapshot.repository.git.dirty ? [`${snapshot.repository.git.changed_file_count} changed file(s)`] : [],
      remediation: snapshot.repository.git.dirty ? ["Commit the intended baseline or explicitly choose a committed ref before creating agent worktrees."] : []
    }),
    capability({
      id: "supported-platform",
      category: "repository",
      weight: 10,
      status: supported ? "pass" : "fail",
      blocking: true,
      summary: supported ? `Detected supported v0 platform(s): ${snapshot.detected.platforms.join(", ")}.` : `No supported v0 platform was detected: ${snapshot.detected.platforms.join(", ")}.`,
      evidence: [...snapshot.detected.frameworks, ...snapshot.inventory.manifests],
      remediation: supported ? [] : ["Install or author a platform pack for this repository surface."]
    }),
    capability({
      id: "project-config",
      category: "repository",
      weight: 5,
      status: validConfig ? "pass" : "fail",
      blocking: true,
      summary: validConfig
        ? (configSource === "external" ? "A valid explicit external DevHarness project declaration exists." : "A valid DevHarness project declaration exists.")
        : hasConfig ? `The DevHarness project declaration is invalid: ${configError ?? "unknown error"}` : "No devharness.yaml declaration exists.",
      evidence: configEvidence,
      remediation: validConfig ? [] : hasConfig ? ["Regenerate or repair devharness.yaml until it satisfies the project-config contract."] : ["Review `devharness init` output, then run it again with --write."]
    }),
    capability({
      id: "dependency-lock",
      category: "bootstrap",
      weight: 10,
      status: !hasManifests ? "not_applicable" : snapshot.inventory.lockfiles.length > 0 ? "pass" : "fail",
      blocking: hasManifests,
      summary: !hasManifests ? "No dependency manifest requires a lockfile." : snapshot.inventory.lockfiles.length > 0 ? "Dependency lockfiles are present." : "Dependency manifests exist without a detected lockfile.",
      evidence: snapshot.inventory.lockfiles,
      remediation: hasManifests && snapshot.inventory.lockfiles.length === 0 ? ["Generate and commit the ecosystem's lockfile."] : []
    }),
    evaluateEnvironment(snapshot),
    evaluateSubmodules(snapshot),
    capability({
      id: "build-command",
      category: "bootstrap",
      weight: 10,
      status: buildReceipt ? "pass" : hasCommand(snapshot, "build") ? "warn" : "fail",
      blocking: true,
      summary: buildReceipt ? "A sealed Supervisor driver attested the build at the current revision." : hasCommand(snapshot, "build") ? "Build command(s) were detected but lack Supervisor-issued evidence." : "No build command was detected.",
      evidence: buildReceipt ? [buildReceipt.id] : snapshot.commands.filter((command) => command.kind === "build").map((command) => `${command.run} (${command.source})`),
      remediation: buildReceipt ? [] : hasCommand(snapshot, "build") ? ["Run a registered Supervisor build driver; a legacy command receipt alone is not trusted proof."] : ["Declare a deterministic build command in devharness.yaml or the project manifest."]
    }),
    capability({
      id: "automated-tests",
      category: "test",
      weight: 10,
      status: testReceipt ? "pass" : hasCommand(snapshot, "test") ? "warn" : "fail",
      blocking: true,
      summary: testReceipt ? "The sealed command-test driver attested passing tests at the current revision." : hasCommand(snapshot, "test") ? "Automated tests were detected but lack Supervisor-issued evidence." : "No automated test command was detected.",
      evidence: testReceipt ? [testReceipt.id] : snapshot.commands.filter((command) => command.kind === "test").map((command) => `${command.run} (${command.source})`),
      remediation: testReceipt ? [] : hasCommand(snapshot, "test") ? ["Run the tests and have the sealed command-test driver attest the current receipt."] : ["Add a deterministic test command and a focused smoke test."]
    }),
    capability({
      id: "behavior-verification",
      category: "verification",
      weight: 15,
      status: behaviorProved ? "pass" : behaviorTool ? "warn" : "fail",
      blocking: true,
      summary: behaviorProved ? "A project verification command and structured real-surface evidence prove behavior at the current revision." : behaviorReceipt ? "A verification command passed, but command success alone is not real-surface behavior proof." : behaviorTool ? "A potential real-surface verification driver was detected but no project recipe has proved it." : "No browser, CLI, API, or equivalent behavior driver was detected.",
      evidence: behaviorProved ? [behaviorReceipt.id, ...behaviorEvidence.map((record) => record.id)] : behaviorReceipt ? [behaviorReceipt.id] : [...snapshot.detected.test_tools, ...snapshot.commands.filter((command) => command.kind === "verify").map((command) => command.run)],
      remediation: behaviorProved ? [] : ["Capture current structured browser, network, API, PTY/filesystem, or equivalent platform evidence for one end-to-end feature."]
    }),
    capability({
      id: "service-launch",
      category: "verification",
      weight: 5,
      status: !requiresLaunch ? "not_applicable" : launchReceipt ? "pass" : hasCommand(snapshot, "launch") ? "warn" : "fail",
      blocking: requiresLaunch,
      summary: !requiresLaunch ? "This surface does not require a long-running service." : launchReceipt ? "Service startup, readiness, and teardown passed at the current revision." : hasCommand(snapshot, "launch") ? "Service launch command(s) were detected but readiness and teardown are unverified." : "The application has no detected launch command.",
      evidence: launchReceipt ? [launchReceipt.id] : snapshot.commands.filter((command) => command.kind === "launch").map((command) => `${command.run} (${command.source})`),
      remediation: requiresLaunch && !launchReceipt ? ["Prove startup, readiness, ownership, and teardown in an isolated run."] : []
    }),
    capability({
      id: "ci-feedback",
      category: "delivery",
      weight: 5,
      status: snapshot.detected.ci_files.length > 0 ? "pass" : "warn",
      blocking: false,
      summary: snapshot.detected.ci_files.length > 0 ? "CI feedback configuration is present." : "No CI workflow was detected.",
      evidence: snapshot.detected.ci_files,
      remediation: snapshot.detected.ci_files.length > 0 ? [] : ["Run the same verification contract in pull-request CI."]
    }),
    capability({
      id: "worktree-isolation",
      category: "isolation",
      weight: 5,
      status: snapshot.repository.git.is_repository && snapshot.repository.git.head_sha ? "pass" : "fail",
      blocking: true,
      summary: snapshot.repository.git.is_repository && snapshot.repository.git.head_sha ? "Git worktree isolation is available to the runtime." : "Worktree isolation requires a committed Git baseline.",
      remediation: snapshot.repository.git.is_repository && snapshot.repository.git.head_sha ? [] : ["Create a baseline commit before dispatching writing agents."]
    }),
    capability({
      id: "supervisor-isolation",
      category: "isolation",
      weight: 5,
      status: "fail",
      blocking: true,
      summary: "Supervisor signatures exist, but worker processes are not yet proven unable to read its key, state, environment or control channel.",
      remediation: ["Run workers under a separate OS identity or capability sandbox, then add a Supervisor-owned isolation probe."]
    }),
    capability({
      id: "pull-request-delivery",
      category: "delivery",
      weight: 5,
      status: snapshot.repository.git.remote_hosts.includes("github.com") ? "pass" : "warn",
      blocking: false,
      summary: snapshot.repository.git.remote_hosts.includes("github.com") ? "GitHub pull-request delivery is detectable." : "No supported pull-request provider was detected.",
      evidence: snapshot.repository.git.remote_hosts,
      remediation: snapshot.repository.git.remote_hosts.includes("github.com") ? [] : ["Configure a supported VCS delivery adapter or use manual delivery."]
    })
  ];

  const applicable = capabilities.filter((item) => item.status !== "not_applicable");
  const denominator = applicable.reduce((total, item) => total + item.weight, 0);
  const points = applicable.reduce((total, item) => total + item.weight * (item.status === "pass" ? 1 : item.status === "warn" ? 0.5 : 0), 0);
  const score = denominator === 0 ? 0 : Math.round((points / denominator) * 100);
  const blockingGaps = capabilities.filter((item) => item.blocking && !["pass", "not_applicable"].includes(item.status));
  const verdict = !snapshot.repository.git.is_repository || !supported ? "unsupported" : blockingGaps.length > 0 ? "needs_work" : "ready";
  const biggestBlockers = [...blockingGaps]
    .sort((a, b) => Number(b.status === "fail") - Number(a.status === "fail") || b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((item) => item.id);

  return {
    schema_version: 1,
    evaluated_at: new Date().toISOString(),
    repository_identity: snapshot.repository.identity,
    overall: {
      verdict,
      score,
      level: readinessLevel(capabilities)
    },
    capabilities,
    biggest_blockers: biggestBlockers
  };
}

export function formatReadinessReport(report) {
  const icons = { pass: "✓", warn: "!", fail: "✗", not_applicable: "·" };
  const lines = [
    "DevHarness Doctor",
    `Repository: ${report.repository_identity}`,
    `Readiness: ${report.overall.verdict} (${report.overall.score}/100), autonomy level ${report.overall.level}/5`,
    ""
  ];

  for (const item of report.capabilities) {
    lines.push(`${icons[item.status]} ${item.id}: ${item.summary}`);
  }

  if (report.biggest_blockers.length > 0) {
    lines.push("", "Biggest blockers:");
    for (const id of report.biggest_blockers) {
      const item = report.capabilities.find((candidate) => candidate.id === id);
      lines.push(`- ${id}: ${item.remediation[0] ?? item.summary}`);
    }
  }

  return lines.join("\n");
}
