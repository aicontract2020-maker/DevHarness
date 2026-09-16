import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const defaultChange = {
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
  const specs = normalizeChangeSpecs(change ?? defaultChange);
  const applied = [];
  for (const spec of specs) {
    applied.push(await applyOneControlledChange(root, spec));
  }
  const status = git(root, ["status", "--porcelain=v1"]);
  if (!status) throw new Error("Controlled-change did not modify the worktree.");
  const primary = applied[0];
  return {
    kind: specs.length === 1 ? primary.kind : "batch",
    relative_path: primary.relative_path,
    contents_sha256: primary.contents_sha256,
    changes: applied,
    porcelain: status
  };
}

function normalizeChangeSpecs(change) {
  if (Array.isArray(change?.changes)) return change.changes;
  if (change?.kind) return [change];
  throw new Error("Controlled-change spec must be a change object or { changes: [...] }.");
}

function assertRelativePath(relative) {
  const value = String(relative ?? "").replace(/^\/+/, "");
  if (!value || value.includes("..") || path.isAbsolute(value)) {
    throw new Error("Controlled-change path must be a relative file inside the worktree.");
  }
  return value;
}

async function applyOneControlledChange(root, spec) {
  const relative = assertRelativePath(spec.relative_path);
  const absolute = canonicalPath(path.join(root, relative));
  if (!isWithin(root, absolute)) {
    throw new Error("Controlled-change path escapes the worktree.");
  }

  if (spec.kind === "ensure-file") {
    if (typeof spec.contents !== "string") throw new Error("ensure-file requires string contents.");
    await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, spec.contents, { encoding: "utf8", mode: 0o600 });
    return {
      kind: spec.kind,
      relative_path: relative,
      contents_sha256: hashContract(spec.contents)
    };
  }

  if (spec.kind === "replace-in-file") {
    const oldString = spec.old_string;
    const newString = spec.new_string;
    if (typeof oldString !== "string" || typeof newString !== "string") {
      throw new Error("replace-in-file requires old_string and new_string.");
    }
    if (!oldString) throw new Error("replace-in-file old_string must be non-empty.");
    let current;
    try {
      current = await readFile(absolute, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`replace-in-file target missing: ${relative}`);
      throw error;
    }
    const matches = current.split(oldString).length - 1;
    if (matches !== 1) {
      throw new Error(`replace-in-file expected exactly one match in ${relative}, found ${matches}.`);
    }
    const next = current.replace(oldString, newString);
    await writeFile(absolute, next, { encoding: "utf8", mode: 0o600 });
    return {
      kind: spec.kind,
      relative_path: relative,
      contents_sha256: hashContract(next),
      old_string_sha256: hashContract(oldString),
      new_string_sha256: hashContract(newString)
    };
  }

  throw new Error(`Unsupported controlled-change kind: ${spec.kind}`);
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
