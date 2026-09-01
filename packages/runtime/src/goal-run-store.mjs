import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { replayGoalRun } from "../../core/src/goal-run.mjs";
import { evaluateInteractionPacket } from "../../core/src/interaction-policy.mjs";
import { assertContract } from "../../project/src/contracts.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { projectDataDirectory } from "./data-store.mjs";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const EVENT_FILE = /^\d{8}\.json$/;

function requireRunId(runId) {
  if (!IDENTIFIER.test(runId ?? "")) throw new Error("Invalid run id.");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

async function readPrivateJson(target) {
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Runtime artifact is not a regular file.");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle?.close();
  }
}

async function atomicWriteJson(target, value) {
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

export function runStoragePaths(dataRoot, repositoryIdentity, runId) {
  requireRunId(runId);
  const runsRoot = path.join(projectDataDirectory(dataRoot, repositoryIdentity), "runs");
  const runRoot = path.join(runsRoot, runId);
  return pathsFromRoots(runsRoot, runRoot);
}

function pathsFromRoots(runsRoot, runRoot) {
  return {
    runsRoot,
    runRoot,
    events: path.join(runRoot, "events"),
    creationEvent: path.join(runRoot, "events", "00000001.json"),
    snapshot: path.join(runRoot, "snapshot.json"),
    current: path.join(runRoot, "current.json"),
    checkpoints: path.join(runRoot, "checkpoints"),
    appendLock: path.join(runRoot, ".append.lock"),
    review: path.join(runRoot, "review"),
    scorecard: path.join(runRoot, "review", "scorecard.json"),
    interaction: path.join(runRoot, "interaction", "current.json")
  };
}

function checkpointPaths(paths, sequence, root = path.join(paths.checkpoints, String(sequence).padStart(8, "0"))) {
  return {
    checkpoint: root,
    events: path.join(root, "events"),
    snapshot: path.join(root, "snapshot.json"),
    review: path.join(root, "review"),
    scorecard: path.join(root, "review", "scorecard.json"),
    interactionDirectory: path.join(root, "interaction"),
    interaction: path.join(root, "interaction", "current.json"),
    artifacts: path.join(root, "artifacts")
  };
}

function assertConsistent(run, event, scorecard) {
  if (event.run_id !== run.id || event.data?.snapshot?.id !== run.id) {
    throw new Error("Creation event does not belong to the Goal Run.");
  }
  if (scorecard.run_id !== run.id || scorecard.repository_identity !== run.repository.identity || scorecard.head_sha !== run.current_head_sha) {
    throw new Error("Review scorecard does not match the Goal Run.");
  }
  if (scorecard.data_source !== "runtime") throw new Error("Stored Goal Run scorecards must identify runtime data.");
}

export async function createStoredGoalRun({ dataRoot, run, event, scorecard }) {
  await assertContract("goal-run", run);
  await assertContract("run-event", event);
  await assertContract("review-scorecard", scorecard);
  assertConsistent(run, event, scorecard);
  const paths = runStoragePaths(dataRoot, run.repository.identity, run.id);
  await mkdir(paths.runsRoot, { recursive: true, mode: 0o700 });
  const stagingRoot = path.join(paths.runsRoot, `.creating-${run.id}-${process.pid}-${randomUUID()}`);
  const staging = pathsFromRoots(paths.runsRoot, stagingRoot);
  try {
    await mkdir(staging.runRoot, { mode: 0o700 });
    await mkdir(staging.events, { mode: 0o700 });
    await mkdir(staging.checkpoints, { mode: 0o700 });
    await mkdir(staging.review, { mode: 0o700 });
    await atomicWriteJson(staging.creationEvent, event);
    await atomicWriteJson(staging.snapshot, run);
    await atomicWriteJson(staging.scorecard, scorecard);
    await atomicWriteJson(staging.current, { schema_version: 1, sequence: 1 });
    await rename(staging.runRoot, paths.runRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    if (["EEXIST", "ENOTEMPTY"].includes(error.code)) throw new Error(`Goal Run ${run.id} already exists.`);
    throw error;
  }
  return { paths };
}

async function readEventsDirectory(eventsDirectory) {
  const entries = await readdir(eventsDirectory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || !EVENT_FILE.test(entry.name))) {
    throw new Error("Goal Run event directory contains an unsafe entry.");
  }
  const events = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const event = await readPrivateJson(path.join(eventsDirectory, entry.name));
    await assertContract("run-event", event);
    events.push(event);
  }
  return events;
}

async function currentView(paths) {
  let pointer;
  try {
    pointer = await readPrivateJson(paths.current);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { sequence: 1, events: paths.events, snapshot: paths.snapshot, scorecard: paths.scorecard, interaction: null, checkpoint: null };
    }
    throw error;
  }
  if (!pointer || pointer.schema_version !== 1 || !Number.isInteger(pointer.sequence) || pointer.sequence < 1 || Object.keys(pointer).some((key) => !["schema_version", "sequence"].includes(key))) {
    throw new Error("Goal Run current checkpoint pointer is invalid.");
  }
  if (pointer.sequence === 1) {
    return { sequence: 1, events: paths.events, snapshot: paths.snapshot, scorecard: paths.scorecard, interaction: null, checkpoint: null };
  }
  const checkpoint = checkpointPaths(paths, pointer.sequence);
  const info = await lstat(checkpoint.checkpoint);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Goal Run checkpoint is not a safe directory.");
  return { sequence: pointer.sequence, events: checkpoint.events, snapshot: checkpoint.snapshot, scorecard: checkpoint.scorecard, interaction: checkpoint.interaction, checkpoint: checkpoint.checkpoint, artifacts: checkpoint.artifacts };
}

export async function loadGoalRun(dataRoot, repositoryIdentity, runId) {
  const paths = runStoragePaths(dataRoot, repositoryIdentity, runId);
  const view = await currentView(paths);
  const events = await readEventsDirectory(view.events);
  const replayed = replayGoalRun(events);
  await assertContract("goal-run", replayed);
  if (replayed.repository.identity !== repositoryIdentity) throw new Error("Goal Run belongs to a different repository.");
  const cached = await readPrivateJson(view.snapshot);
  await assertContract("goal-run", cached);
  if (!same(cached, replayed)) throw new Error("Cached Goal Run snapshot contradicts its event stream.");
  return replayed;
}

export async function loadRunScorecard(dataRoot, repositoryIdentity, runId) {
  const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
  const paths = runStoragePaths(dataRoot, repositoryIdentity, runId);
  const view = await currentView(paths);
  const scorecard = await readPrivateJson(view.scorecard);
  await assertContract("review-scorecard", scorecard);
  if (scorecard.run_id !== run.id || scorecard.repository_identity !== repositoryIdentity || scorecard.head_sha !== run.current_head_sha || scorecard.data_source !== "runtime") {
    throw new Error("Stored scorecard contradicts its Goal Run.");
  }
  return scorecard;
}

export async function loadRunInteraction(dataRoot, repositoryIdentity, runId) {
  const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
  const paths = runStoragePaths(dataRoot, repositoryIdentity, runId);
  const view = await currentView(paths);
  if (!view.interaction) return null;
  const packet = await readPrivateJson(view.interaction);
  await assertContract("interaction-packet", packet);
  const policy = evaluateInteractionPacket(packet);
  if (!policy.valid) throw new Error("Stored interaction packet violates interaction policy.");
  if (packet.run_id !== run.id || packet.head_sha !== run.current_head_sha) throw new Error("Stored interaction packet contradicts its Goal Run.");
  return packet;
}

export async function loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, artifactId) {
  if (!IDENTIFIER.test(artifactId ?? "")) throw new Error("Invalid source artifact id.");
  const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
  const paths = runStoragePaths(dataRoot, repositoryIdentity, runId);
  const view = await currentView(paths);
  if (!view.interaction || !view.artifacts) throw new Error("Goal Run has no current source artifacts.");
  const packet = await readPrivateJson(view.interaction);
  await assertContract("interaction-packet", packet);
  if (packet.run_id !== run.id || packet.head_sha !== run.current_head_sha) {
    throw new Error("Stored interaction packet contradicts its Goal Run.");
  }
  const source = packet.source_artifacts.find((candidate) => candidate.id === artifactId);
  if (!source) throw new Error("Source artifact is not declared by the current interaction packet.");
  const value = await readPrivateJson(path.join(view.artifacts, `${artifactId}.json`));
  if (hashContract(value) !== source.sha256) throw new Error("Stored source artifact hash is invalid.");
  return { source, value };
}

export async function appendGoalRunCheckpoint({ dataRoot, repositoryIdentity, runId, events, nextRun, scorecard, packet, artifacts = [] }) {
  requireRunId(runId);
  const paths = runStoragePaths(dataRoot, repositoryIdentity, runId);
  let lock;
  try {
    lock = await open(paths.appendLock, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Goal Run ${runId} is already being advanced.`);
    throw error;
  }
  try {
    const current = await loadGoalRun(dataRoot, repositoryIdentity, runId);
    const view = await currentView(paths);
    const existingEvents = await readEventsDirectory(view.events);
    if (!Array.isArray(events) || events.length === 0) throw new Error("A checkpoint requires at least one new event.");
    for (const event of events) await assertContract("run-event", event);
    const combinedEvents = [...existingEvents, ...events];
    const replayed = replayGoalRun(combinedEvents);
    await assertContract("goal-run", replayed);
    await assertContract("goal-run", nextRun);
    if (!same(current, replayGoalRun(existingEvents))) throw new Error("Goal Run changed while preparing its checkpoint.");
    if (!same(replayed, nextRun)) throw new Error("Checkpoint snapshot does not match its event stream.");
    if (nextRun.id !== runId || nextRun.repository.identity !== repositoryIdentity) throw new Error("Checkpoint belongs to a different Goal Run.");
    await assertContract("review-scorecard", scorecard);
    if (scorecard.run_id !== runId || scorecard.repository_identity !== repositoryIdentity || scorecard.head_sha !== nextRun.current_head_sha || scorecard.data_source !== "runtime") {
      throw new Error("Checkpoint scorecard does not match the Goal Run.");
    }
    await assertContract("interaction-packet", packet);
    const packetPolicy = evaluateInteractionPacket(packet);
    if (!packetPolicy.valid) throw new Error("Checkpoint interaction packet violates interaction policy.");
    if (packet.run_id !== runId || packet.head_sha !== nextRun.current_head_sha) throw new Error("Checkpoint interaction packet does not match the Goal Run.");
    const sourceById = new Map(packet.source_artifacts.map((source) => [source.id, source]));
    if (artifacts.length !== sourceById.size) throw new Error("Checkpoint source artifact count does not match the interaction packet.");
    for (const entry of artifacts) {
      if (!IDENTIFIER.test(entry.id ?? "") || hashContract(entry.value) !== entry.sha256) throw new Error(`Checkpoint artifact ${entry.id ?? "unknown"} has an invalid hash.`);
      const source = sourceById.get(entry.id);
      if (!source || source.kind !== entry.kind || source.sha256 !== entry.sha256) throw new Error(`Checkpoint artifact ${entry.id} is not bound to the interaction packet.`);
    }

    const sequence = combinedEvents.length;
    const finalCheckpoint = checkpointPaths(paths, sequence);
    const stagingRoot = path.join(paths.checkpoints, `.creating-${String(sequence).padStart(8, "0")}-${process.pid}-${randomUUID()}`);
    const staging = checkpointPaths(paths, sequence, stagingRoot);
    try {
      await mkdir(staging.checkpoint, { mode: 0o700 });
      await mkdir(staging.events, { mode: 0o700 });
      await mkdir(staging.review, { mode: 0o700 });
      await mkdir(staging.interactionDirectory, { mode: 0o700 });
      await mkdir(staging.artifacts, { mode: 0o700 });
      for (const event of combinedEvents) await atomicWriteJson(path.join(staging.events, `${String(event.sequence).padStart(8, "0")}.json`), event);
      await atomicWriteJson(staging.snapshot, nextRun);
      await atomicWriteJson(staging.scorecard, scorecard);
      await atomicWriteJson(staging.interaction, packet);
      for (const entry of artifacts) await atomicWriteJson(path.join(staging.artifacts, `${entry.id}.json`), entry.value);
      await rename(staging.checkpoint, finalCheckpoint.checkpoint);
      await atomicWriteJson(paths.current, { schema_version: 1, sequence });
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      if (["EEXIST", "ENOTEMPTY"].includes(error.code)) throw new Error(`Goal Run ${runId} checkpoint ${sequence} already exists.`);
      throw error;
    }
    return { paths: { ...paths, checkpoint: finalCheckpoint.checkpoint } };
  } finally {
    await lock?.close();
    await rm(paths.appendLock, { force: true });
  }
}

export async function listGoalRunReviews(dataRoot, repositoryIdentity, { limit = 100, now = new Date().toISOString() } = {}) {
  const runsRoot = path.join(projectDataDirectory(dataRoot, repositoryIdentity), "runs");
  let entries;
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") entries = [];
    else throw error;
  }
  const summaries = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory() && IDENTIFIER.test(candidate.name))) {
    try {
      const run = await loadGoalRun(dataRoot, repositoryIdentity, entry.name);
      const scorecard = await loadRunScorecard(dataRoot, repositoryIdentity, entry.name);
      const interaction = await loadRunInteraction(dataRoot, repositoryIdentity, entry.name);
      summaries.push({
        run_id: run.id,
        title: run.goal.refined ?? run.goal.original,
        state: run.state,
        updated_at: run.timestamps.updated_at,
        head_sha: run.current_head_sha,
        verdict: scorecard.verdict,
        proof_score: scorecard.proof_coverage.score,
        blocking_count: scorecard.exception_counts.blocking,
        scorecard_url: `/api/review/runs/${run.id}/scorecard`,
        ...(interaction ? { interaction_url: `/api/review/runs/${run.id}/interaction` } : {}),
        ...(interaction?.source_artifacts.some((source) => source.kind === "onboarding-plan")
          ? { capabilities_url: `/api/review/runs/${run.id}/capabilities` }
          : {})
      });
    } catch {
      // Partial, malformed, linked, tampered, or mismatched runs are not reviewable.
    }
  }
  summaries.sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.run_id.localeCompare(right.run_id));
  const index = {
    schema_version: 1,
    generated_at: now,
    repository_identity: repositoryIdentity,
    runs: summaries.slice(0, Math.max(0, Math.min(100, limit)))
  };
  await assertContract("review-run-index", index);
  return index;
}
