import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { finished } from "node:stream/promises";
import { pathToFileURL } from "node:url";

import { assertContract } from "../../project/src/contracts.mjs";
import { compileProjectHarness, hashContract } from "../../project/src/harness.mjs";
import { resolveExternalDataRoot } from "../../project/src/path-policy.mjs";
import {
  defaultDataRoot,
  prepareVerificationStorage,
  verificationPaths,
  writeReceipt
} from "./data-store.mjs";

const EXECUTABLE_KINDS = new Set(["build", "test", "lint", "typecheck", "verify"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024
  }).trim();
}

function gitDirty(root) {
  return git(root, ["status", "--porcelain=v1"]).length > 0;
}

function environmentContract(snapshot, environment, extraDeclaredKeys = []) {
  const declaredKeys = [...new Set([
    ...snapshot.environment.declared_keys,
    ...extraDeclaredKeys
  ])].sort();
  const setKeys = declaredKeys.filter((key) => typeof environment[key] === "string" && environment[key].length > 0);
  return {
    declared_keys: declaredKeys,
    set_keys: setKeys,
    contract_sha256: sha256(JSON.stringify({ declared_keys: declaredKeys, set_keys: setKeys })),
    values_redacted: true
  };
}

export async function createVerificationPlan({
  snapshot,
  config,
  commandId,
  goalRunId = null,
  dataRoot = defaultDataRoot(),
  timeoutMs = 10 * 60 * 1000,
  environment = process.env,
  commitSha = null
}) {
  if (goalRunId !== null && !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(goalRunId)) {
    throw new Error("Goal Run id is invalid.");
  }
  if (!snapshot.repository.git.is_repository || !snapshot.repository.git.head_sha) {
    throw new Error("Verification requires a committed Git revision.");
  }
  if (snapshot.repository.git.dirty) {
    throw new Error("Verification requires a clean committed baseline.");
  }
  const resolvedCommitSha = commitSha ?? snapshot.repository.git.head_sha;
  if (commitSha) {
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commitSha)) {
      throw new Error("Verification --commit must be a full Git commit SHA.");
    }
  }
  const blockedSubmodules = snapshot.submodules.filter((submodule) => submodule.status !== "initialized");
  if (blockedSubmodules.length > 0) {
    throw new Error(`Verification requires initialized submodules: ${blockedSubmodules.map((item) => item.path).join(", ")}`);
  }
  if (!snapshot.environment.local_files_ignored) {
    throw new Error("Verification is blocked because a local environment file is not ignored by Git.");
  }
  const undocumentedKeys = snapshot.environment.locally_set_keys.filter(
    (key) => !snapshot.environment.declared_keys.includes(key)
  );
  if (undocumentedKeys.length > 0) {
    throw new Error(`Verification is blocked by undocumented environment keys: ${undocumentedKeys.join(", ")}`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 24 * 60 * 60 * 1000) {
    throw new Error("Verification timeout must be between 1 second and 24 hours.");
  }

  const command = config.quality.commands.find((candidate) => candidate.id === commandId);
  if (!command) throw new Error(`Unknown configured command: ${commandId}`);
  if (!EXECUTABLE_KINDS.has(command.kind)) {
    throw new Error("Launch commands require a lifecycle driver with readiness and teardown proof; direct execution is blocked.");
  }

  const { repositoryRoot, dataRoot: resolvedDataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, dataRoot);
  const harness = await compileProjectHarness(snapshot, config);
  const commandBlockers = harness.blockers.filter((blocker) => blocker.subject === commandId);
  if (commandBlockers.length > 0) {
    throw new Error(`Verification is blocked by the project declaration: ${commandBlockers.map((blocker) => blocker.summary).join(" ")}`);
  }
  const resolvedCommand = harness.commands.find((candidate) => candidate.id === commandId);
  const verification = harness.verifications.find((candidate) => candidate.command.id === commandId) ?? {
    command: resolvedCommand,
    service_ids: [],
    warmup: [],
    sha256: hashContract({ command: resolvedCommand, service_ids: [], warmup: [] })
  };
  const services = verification.service_ids.map((serviceId) => harness.services.find((service) => service.id === serviceId));
  const id = `verify-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const paths = verificationPaths(resolvedDataRoot, snapshot.repository.identity, id);
  return {
    id,
    ...(goalRunId ? { goal_run_id: goalRunId } : {}),
    repository_root: repositoryRoot,
    repository_identity: snapshot.repository.identity,
    commit_sha: resolvedCommitSha,
    command: verification.command,
    harness: {
      id: harness.id,
      config_sha256: harness.config_sha256,
      verification_sha256: verification.sha256
    },
    services,
    submodules: snapshot.submodules.map(({ path: submodulePath, commit_sha: commitSha }) => ({
      path: submodulePath,
      commit_sha: commitSha
    })),
    warmup: verification.warmup,
    environment: environmentContract(
      snapshot,
      environment,
      Array.isArray(command.env_keys) ? command.env_keys : []
    ),
    timeout_ms: timeoutMs,
    paths
  };
}

export function formatVerificationPlan(plan) {
  return [
    "DevHarness Verification Plan",
    `Repository: ${plan.repository_identity}`,
    `Revision: ${plan.commit_sha}`,
    `Command: ${plan.command.id} (${plan.command.kind})`,
    `Run: ${plan.command.run}`,
    `Harness: ${plan.harness.id}`,
    `Required services: ${plan.services.length === 0 ? "none" : plan.services.map((service) => service.id).join(", ")}`,
    `Submodules: ${plan.submodules.length}`,
    `Warmup checks: ${plan.warmup.length}`,
    `Isolation: external git worktree`,
    `Timeout: ${plan.timeout_ms}ms`,
    `Artifacts: ${plan.paths.artifacts}`
  ].join("\n");
}

async function fileArtifact(file, type) {
  const content = await readFile(file);
  return {
    type,
    uri: pathToFileURL(file).href,
    media_type: "text/plain",
    sha256: sha256(content),
    size_bytes: content.length
  };
}

async function subjectFileArtifact(file, type, subjectId) {
  return { ...(await fileArtifact(file, type)), subject_id: subjectId };
}

function allowedProcessEnvironment(plan, hostEnvironment) {
  const safeKeys = new Set([
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SHELL",
    "TERM",
    "CI",
    "SystemRoot",
    "ComSpec",
    "PATHEXT"
  ]);
  plan.environment.declared_keys.forEach((key) => safeKeys.add(key));
  const allowed = Object.fromEntries(
    [...safeKeys]
      .filter((key) => typeof hostEnvironment[key] === "string")
      .map((key) => [key, hostEnvironment[key]])
  );
  allowed.DEVHARNESS_RUN_ID = plan.id;
  return allowed;
}

async function runConfiguredCommand(plan, hostEnvironment) {
  const stdoutStream = createWriteStream(plan.paths.stdout, { mode: 0o600 });
  const stderrStream = createWriteStream(plan.paths.stderr, { mode: 0o600 });
  let timedOut = false;

  const child = spawn(plan.command.run, {
    cwd: plan.paths.workspace,
    shell: true,
    env: allowedProcessEnvironment(plan, hostEnvironment),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(stdoutStream, { end: false });
  child.stderr.pipe(stderrStream, { end: false });

  let forceTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    forceTimer = setTimeout(() => {
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 5000);
    forceTimer.unref?.();
  }, plan.timeout_ms);
  timer.unref?.();

  const result = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ exitCode: null, signal: null, error }));
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal, error: null }));
  });
  clearTimeout(timer);
  if (forceTimer) clearTimeout(forceTimer);
  stdoutStream.end();
  stderrStream.end();
  await Promise.all([finished(stdoutStream), finished(stderrStream)]);
  return { ...result, timedOut };
}

function signalProcess(child, signal) {
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already exited between the state check and the signal.
    }
  }
}

function startOwnedService(plan, service, hostEnvironment) {
  const stdoutPath = path.join(plan.paths.artifacts, `service-${service.id}.stdout.log`);
  const stderrPath = path.join(plan.paths.artifacts, `service-${service.id}.stderr.log`);
  const stdoutStream = createWriteStream(stdoutPath, { mode: 0o600 });
  const stderrStream = createWriteStream(stderrPath, { mode: 0o600 });
  const startedAt = new Date().toISOString();
  const child = spawn(service.command.run, {
    cwd: plan.paths.workspace,
    shell: true,
    env: allowedProcessEnvironment(plan, hostEnvironment),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(stdoutStream, { end: false });
  child.stderr.pipe(stderrStream, { end: false });

  const handle = {
    service,
    child,
    stdoutPath,
    stderrPath,
    stdoutStream,
    stderrStream,
    startedAt,
    exited: false,
    result: null
  };
  handle.exitPromise = new Promise((resolve) => {
    child.once("error", (error) => {
      handle.exited = true;
      handle.result = { exitCode: null, signal: null, error };
      resolve(handle.result);
    });
    child.once("close", (exitCode, signal) => {
      if (handle.exited) return;
      handle.exited = true;
      handle.result = { exitCode, signal, error: null };
      resolve(handle.result);
    });
  });
  return handle;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function probeHttpReadiness(readiness, timeoutMs, fetchImplementation = fetch) {
  const response = await fetchImplementation(readiness.url, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs)
  });
  await response.body?.cancel().catch(() => {});
  return { status: response.status, summary: `HTTP ${response.status}` };
}

async function waitForReadinessCheck(handle, readiness, readinessProbe) {
  const deadline = Date.now() + readiness.timeout_ms;
  let lastObservation = "No HTTP response was received.";

  while (Date.now() < deadline) {
    if (handle.exited) {
      const exit = handle.result;
      return {
        status: "fail",
        summary: exit?.error
          ? `Service failed to start: ${exit.error.message}`
          : `Service exited before readiness with code ${exit?.exitCode ?? "unknown"}.`
      };
    }
    const remaining = Math.max(1, deadline - Date.now());
    try {
      const observation = await readinessProbe(
        readiness,
        Math.min(remaining, Math.max(100, readiness.interval_ms))
      );
      lastObservation = observation.summary;
      if (readiness.expected_statuses.includes(observation.status)) {
        return {
          status: "pass",
          ready_at: new Date().toISOString(),
          summary: `${readiness.url} returned HTTP ${observation.status}.`
        };
      }
    } catch (error) {
      lastObservation = error.name === "TimeoutError" ? "HTTP probe timed out." : `HTTP probe failed: ${error.message}`;
    }
    await delay(Math.min(readiness.interval_ms, Math.max(0, deadline - Date.now())));
  }
  return {
    status: "fail",
    summary: `Service did not become ready within ${readiness.timeout_ms}ms. Last observation: ${lastObservation}`
  };
}

async function waitForReadiness(handle, readinessProbe) {
  const { additional_checks: additionalChecks = [], ...primaryCheck } = handle.service.readiness;
  const checks = [primaryCheck, ...additionalChecks];
  const results = await Promise.all(
    checks.map(async (check) => ({
      ...check,
      ...(await waitForReadinessCheck(handle, check, readinessProbe))
    }))
  );
  const failed = results.filter((result) => result.status !== "pass");
  if (failed.length > 0) {
    return {
      status: "fail",
      summary: `${failed.length} of ${results.length} readiness checks failed: ${failed.map((result) => result.url).join(", ")}.`,
      checks: results
    };
  }
  return {
    status: "pass",
    ready_at: results.map((result) => result.ready_at).sort().at(-1),
    summary: `All ${results.length} readiness checks passed.`,
    checks: results
  };
}


function prepareDependencies(plan, hostEnvironment) {
  const workspace = plan.paths.workspace;
  const lockfile = path.join(workspace, "package-lock.json");
  const manifest = path.join(workspace, "package.json");
  if (!existsSync(lockfile) || !existsSync(manifest)) {
    return { status: "not_required", summary: "No npm lockfile is present in the verification worktree." };
  }
  try {
    execFileSync("npm", ["ci", "--no-fund", "--no-audit"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: allowedProcessEnvironment(plan, hostEnvironment),
      maxBuffer: 32 * 1024 * 1024
    });
    materializeLocalConfigFiles(plan);
    return { status: "pass", summary: "Installed npm dependencies from the committed lockfile." };
  } catch (error) {
    const detail = (error.stderr?.toString?.() || error.stdout?.toString?.() || error.message || "").trim();
    const tail = detail.split("\n").slice(-8).join(" ").trim();
    return { status: "fail", summary: `npm ci failed: ${tail || error.message}` };
  }
}

function materializeLocalConfigFiles(plan) {
  const workspace = plan.paths.workspace;
  const sourceRoot = plan.repository_root;
  const target = path.join(workspace, "data", "config.js");
  if (existsSync(target)) return;
  for (const sourceRel of ["data/config.js", "data/testing.config.js"]) {
    const source = path.join(sourceRoot, sourceRel);
    if (!existsSync(source)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    return;
  }
}


function prepareSubmodules(plan) {
  if (plan.submodules.length === 0) {
    return { status: "not_required", summary: "The revision declares no submodules.", submodules: [] };
  }
  const sourceRoot = path.resolve(plan.repository_root);
  const workspaceRoot = path.resolve(plan.paths.workspace);
  const records = [...plan.submodules]
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path))
    .map((submodule) => {
      const sourceModuleRoot = path.resolve(sourceRoot, submodule.path);
      const moduleRoot = path.resolve(plan.paths.workspace, submodule.path);
      if (!sourceModuleRoot.startsWith(`${sourceRoot}${path.sep}`) || !moduleRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
        return { ...submodule, status: "failed", summary: "The declared submodule path escapes the verification worktree." };
      }
      try {
        const sourceCommit = git(sourceModuleRoot, ["rev-parse", "HEAD"]);
        if (sourceCommit !== submodule.commit_sha) {
          return { ...submodule, status: "failed", summary: `The initialized source checkout is at ${sourceCommit}, not ${submodule.commit_sha}.` };
        }
        git(plan.repository_root, ["clone", "--local", "--no-hardlinks", "--no-checkout", "--", sourceModuleRoot, moduleRoot]);
        git(moduleRoot, ["checkout", "--detach", submodule.commit_sha]);
        const actualCommit = git(moduleRoot, ["rev-parse", "HEAD"]);
        const matches = actualCommit === submodule.commit_sha;
        return {
          ...submodule,
          status: matches ? "materialized" : "failed",
          summary: matches
            ? `Materialized revision ${actualCommit} from the initialized source checkout.`
            : `Expected ${submodule.commit_sha}, but materialized ${actualCommit}.`
        };
      } catch (error) {
        return { ...submodule, status: "failed", summary: `Materialization failed: ${error.message}` };
      }
    });
  const failed = records.filter((record) => record.status === "failed");
  return {
    status: failed.length === 0 ? "pass" : "fail",
    summary: failed.length === 0
      ? `Materialized ${records.length} revision-pinned submodule${records.length === 1 ? "" : "s"}.`
      : `${failed.length} of ${records.length} submodules did not match the pinned revision.`,
    submodules: records
  };
}

async function runWarmup(plan, serviceHandles, readinessProbe) {
  if (plan.warmup.length === 0) {
    return { status: "not_required", summary: "No HTTP warmup is declared.", checks: [] };
  }
  const checks = [];
  for (const check of plan.warmup) {
    const activeHandle = serviceHandles.find((handle) => !handle.exited) ?? serviceHandles[0];
    if (!activeHandle) {
      checks.push({ ...check, status: "fail", summary: "No owned service is available for warmup." });
      continue;
    }
    checks.push({ ...check, ...(await waitForReadinessCheck(activeHandle, check, readinessProbe)) });
  }
  const failed = checks.filter((check) => check.status !== "pass");
  return {
    status: failed.length === 0 ? "pass" : "fail",
    summary: failed.length === 0
      ? `All ${checks.length} declared warmup checks passed.`
      : `${failed.length} of ${checks.length} declared warmup checks failed.`,
    checks
  };
}

async function runServiceCleanup(plan, handle, hostEnvironment) {
  const { run } = handle.service.shutdown;
  if (!run) return null;
  const timeoutMs = handle.service.shutdown.timeout_ms ?? handle.service.shutdown.grace_ms;
  let timedOut = false;
  const child = spawn(run, {
    cwd: plan.paths.workspace,
    shell: true,
    env: allowedProcessEnvironment(plan, hostEnvironment),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(handle.stdoutStream, { end: false });
  child.stderr.pipe(handle.stderrStream, { end: false });

  let forceTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    signalProcess(child, "SIGTERM");
    forceTimer = setTimeout(() => signalProcess(child, "SIGKILL"), 5000);
    forceTimer.unref?.();
  }, timeoutMs);
  timer.unref?.();
  const result = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ exitCode: null, signal: null, error }));
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, error: null }));
  });
  clearTimeout(timer);
  if (forceTimer) clearTimeout(forceTimer);
  const passed = !result.error && result.exitCode === 0 && !timedOut;
  return {
    run,
    timeout_ms: timeoutMs,
    status: passed ? "pass" : "fail",
    ...(Number.isInteger(result.exitCode) ? { exit_code: result.exitCode } : {}),
    ...(result.signal ? { signal: result.signal } : {}),
    timed_out: timedOut,
    summary: result.error
      ? `Cleanup failed to start: ${result.error.message}`
      : timedOut
        ? `Cleanup exceeded its ${timeoutMs}ms timeout.`
        : result.exitCode === 0
          ? "Explicit cleanup command completed successfully."
          : `Cleanup exited with code ${result.exitCode}.`
  };
}

async function stopOwnedService(plan, handle, hostEnvironment) {
  let escalated = false;
  if (!handle.exited) {
    signalProcess(handle.child, "SIGTERM");
    await Promise.race([handle.exitPromise, delay(handle.service.shutdown.grace_ms)]);
  }
  if (!handle.exited) {
    escalated = true;
    signalProcess(handle.child, "SIGKILL");
    await Promise.race([handle.exitPromise, delay(5000)]);
  }
  const processStopped = handle.exited;
  const cleanup = await runServiceCleanup(plan, handle, hostEnvironment);
  handle.stdoutStream.end();
  handle.stderrStream.end();
  await Promise.allSettled([finished(handle.stdoutStream), finished(handle.stderrStream)]);
  const passed = processStopped && (!cleanup || cleanup.status === "pass");
  return {
    status: passed ? "pass" : "fail",
    summary: !processStopped
      ? "Service process did not exit after SIGTERM and SIGKILL."
      : cleanup?.status === "fail"
        ? "Service exited, but explicit cleanup failed."
        : escalated
          ? "Service required SIGKILL, exited, and cleanup completed."
          : cleanup
            ? "Service exited after bounded graceful termination and cleanup completed."
            : "Service exited after bounded graceful termination.",
    completed_at: new Date().toISOString(),
    ...(cleanup ? { cleanup } : {})
  };
}

export async function executeVerificationPlan(plan, {
  environment = process.env,
  readinessProbe = probeHttpReadiness
} = {}) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  let worktreeCreated = false;
  let dirtyBefore = false;
  let dirtyAfter = false;
  let commandResult = { exitCode: null, signal: null, error: null, timedOut: false };
  let setupError = null;
  let preparation = { status: "not_required", summary: "Preparation did not begin.", submodules: [] };
  let warmup = { status: "not_required", summary: "Warmup did not begin.", checks: [] };
  let unexpectedServiceExits = [];
  const serviceHandles = [];
  const serviceRecords = [];
  let teardownStatus = "not_required";
  let teardownSummary = "No worktree was created.";

  await prepareVerificationStorage(plan.paths);
  try {
    git(plan.repository_root, ["worktree", "add", "--detach", plan.paths.workspace, plan.commit_sha]);
    worktreeCreated = true;
    preparation = prepareSubmodules(plan);
    if (preparation.status === "fail") throw new Error(preparation.summary);
    const dependencyPreparation = prepareDependencies(plan, environment);
    if (dependencyPreparation.status === "fail") throw new Error(dependencyPreparation.summary);
    if (dependencyPreparation.status === "pass") {
      preparation = {
        ...preparation,
        summary: preparation.status === "not_required"
          ? dependencyPreparation.summary
          : `${preparation.summary} ${dependencyPreparation.summary}`,
        status: preparation.status === "fail" ? "fail" : "pass"
      };
    }
    dirtyBefore = gitDirty(plan.paths.workspace);
    for (const service of plan.services) {
      const handle = startOwnedService(plan, service, environment);
      serviceHandles.push(handle);
      const readinessResult = await waitForReadiness(handle, readinessProbe);
      serviceRecords.push({ handle, readinessResult });
      if (readinessResult.status !== "pass") {
        throw new Error(`Service ${service.id} failed readiness: ${readinessResult.summary}`);
      }
    }
    warmup = await runWarmup(plan, serviceHandles, readinessProbe);
    if (warmup.status === "fail") throw new Error(warmup.summary);
    commandResult = await runConfiguredCommand(plan, environment);
  } catch (error) {
    setupError = error;
    await Promise.all([
      readFile(plan.paths.stdout).catch(() => writeFile(plan.paths.stdout, "", { mode: 0o600 })),
      readFile(plan.paths.stderr).catch(() => writeFile(plan.paths.stderr, `${error.message}\n`, { mode: 0o600 }))
    ]);
  } finally {
    unexpectedServiceExits = serviceRecords
      .filter(({ handle, readinessResult }) => readinessResult.status === "pass" && handle.exited)
      .map(({ handle }) => handle.service.id);
    for (const handle of [...serviceHandles].reverse()) {
      handle.teardown = await stopOwnedService(plan, handle, environment);
    }
    if (worktreeCreated) {
      try {
        dirtyAfter = gitDirty(plan.paths.workspace);
        git(plan.repository_root, ["worktree", "remove", "--force", plan.paths.workspace]);
        git(plan.repository_root, ["worktree", "prune"]);
        const serviceTeardownFailed = serviceHandles.some((handle) => handle.teardown?.status !== "pass");
        teardownStatus = serviceTeardownFailed ? "fail" : "pass";
        teardownSummary = serviceTeardownFailed
          ? "The worktree was removed, but at least one owned service did not prove teardown."
          : "All owned services exited and the isolated worktree was removed and pruned.";
      } catch (error) {
        teardownStatus = "fail";
        teardownSummary = `Worktree cleanup failed: ${error.message}`;
      }
    }
  }

  const completed = Date.now();
  const commandPassed =
    !setupError &&
    commandResult.exitCode === 0 &&
    !commandResult.timedOut &&
    !dirtyBefore &&
    !dirtyAfter &&
    serviceRecords.every((record) => record.readinessResult.status === "pass") &&
    preparation.status !== "fail" &&
    warmup.status !== "fail" &&
    unexpectedServiceExits.length === 0 &&
    teardownStatus === "pass";
  const status = setupError && !worktreeCreated ? "blocked" : commandPassed ? "pass" : "fail";
  const reason = status === "blocked"
    ? "blocked"
    : preparation.status === "fail"
      ? "preparation-failed"
      : serviceRecords.some((record) => record.readinessResult.status === "fail")
        ? "service-readiness"
        : unexpectedServiceExits.length > 0
          ? "service-exited"
          : warmup.status === "fail"
            ? "warmup-failed"
            : commandResult.timedOut
              ? "command-timeout"
              : dirtyBefore || dirtyAfter
                ? "workspace-dirty"
                : commandResult.exitCode !== 0
                  ? "command-failed"
                  : teardownStatus !== "pass"
                    ? "teardown-failed"
                    : "passed";
  const summary = unexpectedServiceExits.length > 0
    ? `Owned service exited unexpectedly: ${unexpectedServiceExits.join(", ")}.`
    : setupError
    ? `Verification could not complete: ${setupError.message}`
    : commandResult.timedOut
      ? "The command exceeded its timeout."
      : dirtyAfter
        ? "The command changed non-ignored files in its verification worktree."
        : commandResult.exitCode !== 0
          ? `The command exited with code ${commandResult.exitCode}.`
          : teardownStatus !== "pass"
            ? "The command passed but isolated teardown failed."
            : "The command completed successfully in a clean isolated worktree.";

  const artifacts = await Promise.all([
    fileArtifact(plan.paths.stdout, "stdout"),
    fileArtifact(plan.paths.stderr, "stderr"),
    ...serviceHandles.flatMap((handle) => [
      subjectFileArtifact(handle.stdoutPath, "service-stdout", handle.service.id),
      subjectFileArtifact(handle.stderrPath, "service-stderr", handle.service.id)
    ])
  ]);
  const receipt = {
    schema_version: 1,
    id: plan.id,
    ...(plan.goal_run_id ? { goal_run_id: plan.goal_run_id } : {}),
    repository_identity: plan.repository_identity,
    commit_sha: plan.commit_sha,
    command: plan.command,
    harness: plan.harness,
    services: serviceRecords.map(({ handle, readinessResult }) => {
      const { additional_checks: _additionalChecks, ...primaryReadiness } = handle.service.readiness;
      return {
        id: handle.service.id,
        command: handle.service.command,
        lifecycle_sha256: handle.service.sha256,
        readiness: {
          ...primaryReadiness,
          ...readinessResult
        },
        started_at: handle.startedAt,
        status: unexpectedServiceExits.includes(handle.service.id)
          ? "exited"
          : readinessResult.status === "pass" ? "ready" : "failed",
        unexpected_exit: unexpectedServiceExits.includes(handle.service.id),
        ...(Number.isInteger(handle.result?.exitCode) ? { exit_code: handle.result.exitCode } : {}),
        ...(handle.result?.signal ? { signal: handle.result.signal } : {}),
        teardown: handle.teardown
      };
    }),
    preparation,
    warmup,
    workspace: {
      isolation: "git-worktree",
      root_uri: pathToFileURL(plan.paths.workspace).href,
      dirty_before: dirtyBefore,
      dirty_after: dirtyAfter
    },
    environment: plan.environment,
    started_at: startedAt,
    completed_at: new Date(completed).toISOString(),
    duration_ms: completed - started,
    outcome: {
      status,
      reason,
      ...(Number.isInteger(commandResult.exitCode) ? { exit_code: commandResult.exitCode } : {}),
      ...(commandResult.signal ? { signal: commandResult.signal } : {}),
      timed_out: commandResult.timedOut,
      summary
    },
    artifacts,
    teardown: {
      required: worktreeCreated,
      status: teardownStatus,
      summary: teardownSummary,
      ...(worktreeCreated ? { completed_at: new Date().toISOString() } : {})
    },
    runtime: {
      devharness_version: "0.0.0",
      node_version: process.version,
      platform: process.platform,
      arch: process.arch
    }
  };

  await assertContract("verification-receipt", receipt);
  await writeReceipt(plan.paths.receipt, receipt);
  return receipt;
}
