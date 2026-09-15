import { assertContract } from "./contracts.mjs";
import { compileProjectHarness, hashContract } from "./harness.mjs";

function dimension(id, label, earned, possible) {
  return {
    id,
    label,
    earned,
    possible,
    status: earned === possible ? "covered" : earned === 0 ? "missing" : "partial"
  };
}

export async function createProjectDeclarationReview(snapshot, config, options = {}) {
  const harness = await compileProjectHarness(snapshot, config, options);
  const interactive = config.platforms.some((platform) => ["web", "mobile", "desktop"].includes(platform));
  const launchCommands = harness.commands.filter((command) => command.kind === "launch");
  const verificationCommands = harness.commands.filter((command) => command.kind === "verify");
  const mappedLaunchIds = new Set(harness.services.map((service) => service.command.id));
  const boundVerificationIds = new Set(harness.verifications.filter((verification) => !interactive || verification.service_ids.length > 0).map((verification) => verification.command.id));
  const lifecycleEarned = launchCommands.length === 0
    ? (interactive ? 0 : 25)
    : Math.round(25 * mappedLaunchIds.size / launchCommands.length);
  const verificationEarned = verificationCommands.length === 0
    ? 0
    : Math.round(20 * boundVerificationIds.size / verificationCommands.length);
  const dimensions = [
    dimension("repository-baseline", "Committed repository baseline", snapshot.repository.git.head_sha && !snapshot.repository.git.dirty ? 20 : 0, 20),
    dimension("platform-model", "Platform detection", config.platforms.every((platform) => platform !== "unknown") ? 15 : 0, 15),
    dimension("command-model", "Build and test commands", harness.commands.some((command) => ["build", "test"].includes(command.kind)) ? 20 : 0, 20),
    dimension("service-lifecycle", "Owned service lifecycle", lifecycleEarned, 25),
    dimension("behavior-verification", "Real behavior verification", verificationEarned, 20)
  ];
  const blockers = [
    ...harness.blockers,
    ...(!harness.commands.some((command) => ["build", "test"].includes(command.kind)) ? [{
      code: "build-test-command-missing",
      subject: config.project.id,
      summary: "The declaration has no build or unit-test command to prove implementation quality."
    }] : []),
    ...(interactive && verificationCommands.length === 0 ? [{
      code: "behavior-verification-missing",
      subject: config.project.id,
      summary: "The interactive project has no real behavior verification command."
    }] : [])
  ].sort((left, right) => left.code.localeCompare(right.code) || left.subject.localeCompare(right.subject));
  const verdict = blockers.length > 0 ? "blocked" : "review-required";
  const executionSurfaces = harness.commands
    .filter((command) => ["launch", "verify"].includes(command.kind))
    .map((command) => ({
      id: command.id,
      kind: command.kind,
      run: command.run,
      source: command.source,
      status: command.kind === "launch"
        ? (mappedLaunchIds.has(command.id) ? "mapped" : "unmapped")
        : (boundVerificationIds.has(command.id) ? "mapped" : "unmapped")
    }));
  const needsRuntimeDecision = blockers.some((blocker) => ["service-lifecycle-unconfigured", "interactive-verification-unbound"].includes(blocker.code));
  const decision = needsRuntimeDecision ? {
    id: "confirm-autonomous-test-runtime",
    title: "Confirm the autonomous test runtime",
    question: "Which one launch recipe may DevHarness own to start the complete local test system?",
    reason: "Browser verification is meaningful only when frontend, backend and required data services are started, observed and torn down as one bounded lifecycle.",
    evidence_refs: [...new Set([...executionSurfaces.map((surface) => surface.source), ...snapshot.detected.deployment_files])].slice(0, 8),
    required_fields: ["launch command", "loopback readiness URL", "shutdown behavior", "verification binding"]
  } : null;
  const review = {
    schema_version: 1,
    id: `declaration-review-${hashContract({ repository_identity: snapshot.repository.identity, head_sha: snapshot.repository.git.head_sha, config }).slice(0, 32)}`,
    repository_identity: snapshot.repository.identity,
    head_sha: snapshot.repository.git.head_sha,
    proposal_sha256: hashContract(config),
    verdict,
    approval_available: blockers.length === 0,
    structural_coverage: dimensions.reduce((total, item) => total + item.earned, 0),
    counts: {
      commands: harness.commands.length,
      launch_commands: launchCommands.length,
      configured_services: harness.services.length,
      verification_jobs: verificationCommands.length,
      service_bound_verifications: boundVerificationIds.size,
      blockers: blockers.length
    },
    dimensions,
    execution_surfaces: executionSurfaces,
    blockers,
    ...(decision ? { decision } : {}),
    next_action: blockers.length > 0
      ? "Resolve the single runtime decision, regenerate the declaration, then review it again."
      : "Review the exact execution surfaces, then explicitly accept the project declaration."
  };
  await assertContract("project-declaration-review", review);
  return review;
}
