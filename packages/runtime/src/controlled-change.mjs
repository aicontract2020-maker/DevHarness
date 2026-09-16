import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { hashContract } from "../../project/src/harness.mjs";
import { canonicalPath, isWithin } from "../../project/src/path-policy.mjs";
import { projectDataDirectory } from "./data-store.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024
  }).trim();
}

export function createVcsWriteCapabilityRequest(snapshot) {
  if (!snapshot?.repository?.identity || !snapshot?.repository?.git?.head_sha) return null;
  return {
    id: "vcs-write",
    capability: "vcs-write",
    operation: "bounded-consumer-change",
    target: snapshot.repository.git.head_sha,
    scope: [
      `repository:${snapshot.repository.identity}`,
      `revision:${snapshot.repository.git.head_sha}`,
      "isolated-worktree-only",
      "no-force-push",
      "no-main-checkout-mutation"
    ],
    reason: "Apply a Gate-1-approved, bounded consumer change inside an isolated Git worktree before verification.",
    risk: "high",
    authority: "human-only",
    reversibility: "Worktree commits stay outside the main checkout until an explicit promote/PR step; worktree can be removed.",
    decision: "pending"
  };
}

export function resolveControlledChangeWorktreePath({ dataRoot, repositoryIdentity, runId, worktreeDir = null }) {
  const defaultDir = path.join(projectDataDirectory(dataRoot, repositoryIdentity), "runs", runId, "change-worktree");
  return canonicalPath(worktreeDir ?? defaultDir);
}

export async function createControlledChangeWorktree({
  repositoryRoot,
  worktreePath,
  headSha
}) {
  const root = canonicalPath(repositoryRoot);
  const target = canonicalPath(worktreePath);
  if (isWithin(root, target)) {
    throw new Error("Controlled-change worktree must live outside the consumer repository.");
  }
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    git(root, ["worktree", "add", "--detach", target, headSha]);
  } catch (error) {
    const message = error?.stderr?.toString?.() || error.message;
    throw new Error(`Failed to create controlled-change worktree: ${message}`);
  }
  return { worktree_path: target, baseline_sha: headSha };
}

export async function applyBoundedControlledChange({
  worktreePath,
  change = null,
  runId,
  generatedAt = new Date().toISOString()
}) {
  const root = canonicalPath(worktreePath);
  const spec = change ?? {
    kind: "ensure-file",
    relative_path: "DEVHARNESS_CONTROLLED_CHANGE.md",
    contents: [
      "# DevHarness controlled change",
      "",
      `- Run: ${runId ?? "unknown"}`,
      `- Generated at: ${generatedAt}`,
      "",
      "This file was written under an approved `vcs-write` capability inside an isolated worktree.",
      "It must not appear in the consumer main checkout unless explicitly promoted.",
      ""
    ].join("\n")
  };

  if (spec.kind !== "ensure-file") {
    throw new Error(`Unsupported controlled-change kind: ${spec.kind}`);
  }
  const relative = String(spec.relative_path ?? "").replace(/^\/+/, "");
  if (!relative || relative.includes("..") || path.isAbsolute(relative)) {
    throw new Error("Controlled-change path must be a relative file inside the worktree.");
  }
  const absolute = canonicalPath(path.join(root, relative));
  if (!isWithin(root, absolute)) {
    throw new Error("Controlled-change path escapes the worktree.");
  }
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  await writeFile(absolute, spec.contents, { encoding: "utf8", mode: 0o600 });
  const status = git(root, ["status", "--porcelain=v1"]);
  if (!status) throw new Error("Controlled-change did not modify the worktree.");
  return {
    kind: spec.kind,
    relative_path: relative,
    contents_sha256: hashContract(spec.contents),
    porcelain: status
  };
}

export function commitControlledChange({
  worktreePath,
  message,
  authorName = "DevHarness Controlled Change",
  authorEmail = "devharness-controlled-change@example.invalid"
}) {
  const root = canonicalPath(worktreePath);
  git(root, ["add", "-A"]);
  execFileSync("git", ["-C", root, "commit", "-m", message], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: authorName,
      GIT_COMMITTER_EMAIL: authorEmail
    },
    maxBuffer: 16 * 1024 * 1024
  });
  const changeSha = git(root, ["rev-parse", "HEAD"]);
  const dirty = git(root, ["status", "--porcelain=v1"]).length > 0;
  if (dirty) throw new Error("Controlled-change commit left a dirty worktree.");
  return { change_commit_sha: changeSha };
}

export function removeControlledChangeWorktree({ repositoryRoot, worktreePath }) {
  const root = canonicalPath(repositoryRoot);
  const target = canonicalPath(worktreePath);
  try {
    git(root, ["worktree", "remove", "--force", target]);
  } catch {
    // fall through to prune
  }
  git(root, ["worktree", "prune"]);
}

export function findApprovedVcsWrite(view) {
  const item = (view?.capabilities ?? []).find((candidate) =>
    candidate.request?.id === "vcs-write" || candidate.request?.capability === "vcs-write"
  );
  if (!item) return { allowed: false, status: "unrequested", reasons: ["vcs-write was not requested on the current Goal Run."] };
  if (item.status !== "approved") {
    return {
      allowed: false,
      status: item.status,
      reasons: [`vcs-write is ${item.status}; human-only approval is required before consumer mutation.`]
    };
  }
  return { allowed: true, status: "approved", reasons: [], item };
}
