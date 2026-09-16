import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashContract } from "../../project/src/harness.mjs";
import { canonicalPath } from "../../project/src/path-policy.mjs";
import { projectDataDirectory } from "./data-store.mjs";

function git(root, args, options = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
    ...options
  }).trim();
}

function gh(args, options = {}) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
    ...options
  }).trim();
}

export function defaultPromoteBranchName(runId) {
  const short = String(runId ?? "run").replace(/^run-/, "").slice(0, 12);
  return `dogfood/devharness-promote-${short}`;
}

export function promoteSupported({ run, readiness }) {
  if (!run || run.state !== "completed") {
    return { ok: false, reason: "Promote requires a completed Goal Run (Gate 2 approved)." };
  }
  if (run.gates?.delivery?.status !== "approved") {
    return { ok: false, reason: "Promote requires gates.delivery.status=approved." };
  }
  if (readiness?.delivery_mode !== "controlled-change") {
    return { ok: false, reason: "Promote applies only to controlled-change deliveries." };
  }
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(readiness?.change_commit_sha ?? "")) {
    return { ok: false, reason: "Promote requires readiness.change_commit_sha." };
  }
  if (readiness.head_sha && readiness.head_sha !== run.current_head_sha) {
    return { ok: false, reason: "Promote readiness baseline does not match the Goal Run head." };
  }
  return { ok: true, reason: null };
}

/**
 * Publish an isolated controlled-change commit onto a named branch without
 * mutating the consumer working tree. Never force-pushes and never merges.
 */
export async function promoteControlledChange({
  repositoryRoot,
  dataRoot,
  repositoryIdentity,
  run,
  readiness,
  branchName = null,
  baseRef = null,
  push = false,
  createPr = false,
  generatedAt = new Date().toISOString(),
  gitExec = git,
  ghExec = gh
}) {
  const support = promoteSupported({ run, readiness });
  if (!support.ok) throw new Error(support.reason);

  const root = canonicalPath(repositoryRoot);
  const changeSha = readiness.change_commit_sha;
  const branch = branchName || defaultPromoteBranchName(run.id);
  if (!/^[A-Za-z0-9._\/+-]+$/.test(branch) || branch.includes("..")) {
    throw new Error("Promote branch name is invalid.");
  }

  // Ensure the object is reachable from this repository (worktree commits share the object store).
  try {
    gitExec(root, ["cat-file", "-t", changeSha]);
  } catch {
    throw new Error(`Change commit ${changeSha} is not reachable from the consumer repository.`);
  }

  const dirty = gitExec(root, ["status", "--porcelain=v1"]);
  if (dirty) {
    throw new Error("Promote refuses to run while the consumer checkout is dirty.");
  }

  let branchCreated = false;
  let branchUpdated = false;
  try {
    const existing = gitExec(root, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    if (existing === changeSha) {
      branchUpdated = false;
    } else {
      throw new Error(`Promote branch ${branch} already exists at ${existing.slice(0, 12)}; refusing to move it (no force).`);
    }
  } catch (error) {
    if (/already exists/.test(error.message)) throw error;
    gitExec(root, ["branch", branch, changeSha]);
    branchCreated = true;
  }

  const afterBranch = gitExec(root, ["rev-parse", `refs/heads/${branch}`]);
  if (afterBranch !== changeSha) {
    throw new Error("Promote branch does not point at the controlled-change commit.");
  }

  // Working tree must remain on its original HEAD.
  const headAfter = gitExec(root, ["rev-parse", "HEAD"]);
  if (headAfter !== run.current_head_sha) {
    throw new Error("Promote unexpectedly moved the consumer HEAD; aborting.");
  }
  if (gitExec(root, ["status", "--porcelain=v1"])) {
    throw new Error("Promote left the consumer checkout dirty.");
  }

  let pushed = false;
  let prUrl = null;
  if (push || createPr) {
    gitExec(root, ["push", "-u", "origin", `refs/heads/${branch}:refs/heads/${branch}`]);
    pushed = true;
  }
  if (createPr) {
    const base = baseRef || run.repository.base_ref || "main";
    const title = `DevHarness promote: ${run.id}`;
    const body = [
      "## Summary",
      `- Goal Run: \`${run.id}\``,
      `- Change commit: \`${changeSha}\``,
      `- Baseline: \`${run.current_head_sha}\``,
      `- Path: \`${readiness.change_path ?? "bounded controlled change"}\``,
      "",
      "Promoted by DevHarness after Gate 2 delivery approval.",
      "This PR was opened explicitly; DevHarness does not auto-merge."
    ].join("\n");
    prUrl = ghExec([
      "pr", "create",
      "--repo", inferGithubRepo(root, gitExec),
      "--base", base,
      "--head", branch,
      "--title", title,
      "--body", body
    ], { cwd: root });
  }

  const record = {
    schema_version: 1,
    kind: "promote-record",
    run_id: run.id,
    generated_at: generatedAt,
    repository_identity: repositoryIdentity ?? run.repository.identity,
    baseline_sha: run.current_head_sha,
    change_commit_sha: changeSha,
    branch,
    branch_created: branchCreated,
    branch_already_matched: !branchCreated && !branchUpdated,
    pushed,
    pr_url: prUrl,
    change_path: readiness.change_path ?? null,
    change_worktree: readiness.change_worktree ?? null
  };

  const deliveryDir = path.join(projectDataDirectory(dataRoot, record.repository_identity), "runs", run.id, "delivery");
  await mkdir(deliveryDir, { recursive: true, mode: 0o700 });
  const recordPath = path.join(deliveryDir, "promote.json");
  const recordSha = hashContract(record);
  await writeFile(recordPath, `${JSON.stringify({ ...record, sha256: recordSha }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { ...record, path: recordPath, sha256: recordSha };
}

function inferGithubRepo(root, gitExec) {
  const url = gitExec(root, ["remote", "get-url", "origin"]);
  const ssh = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  const https = url.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (https) return `${https[1]}/${https[2]}`;
  throw new Error(`Cannot infer GitHub repo from origin URL: ${url}`);
}
