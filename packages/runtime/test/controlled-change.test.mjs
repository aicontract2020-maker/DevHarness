import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyBoundedControlledChange,
  commitControlledChange,
  createControlledChangeWorktree,
  createVcsWriteCapabilityRequest,
  findApprovedVcsWrite,
  removeControlledChangeWorktree
} from "../src/controlled-change.mjs";

async function tempGitRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-controlled-change-repo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "README.md"), "# fixture\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { root, head };
}

test("vcs-write capability request is human-only and revision-bound", () => {
  const request = createVcsWriteCapabilityRequest({
    repository: { identity: "example/project", git: { head_sha: "a".repeat(40) } }
  });
  assert.equal(request.id, "vcs-write");
  assert.equal(request.capability, "vcs-write");
  assert.equal(request.authority, "human-only");
  assert.ok(request.scope.includes("isolated-worktree-only"));
});

test("findApprovedVcsWrite fails closed until approved", () => {
  assert.equal(findApprovedVcsWrite({ capabilities: [] }).allowed, false);
  assert.equal(findApprovedVcsWrite({
    capabilities: [{ request: { id: "vcs-write", capability: "vcs-write" }, status: "pending" }]
  }).allowed, false);
  assert.equal(findApprovedVcsWrite({
    capabilities: [{ request: { id: "vcs-write", capability: "vcs-write" }, status: "approved" }]
  }).allowed, true);
});

test("controlled change mutates an isolated worktree and leaves the main checkout clean", async (t) => {
  const { root, head } = await tempGitRepo(t);
  const worktree = await mkdtemp(path.join(os.tmpdir(), "devharness-controlled-change-wt-"));
  t.after(async () => {
    try { removeControlledChangeWorktree({ repositoryRoot: root, worktreePath: worktree }); } catch {}
    await rm(worktree, { recursive: true, force: true });
  });
  // git worktree add wants the path not to exist as a non-empty dir sometimes - remove and let create recreate parent
  await rm(worktree, { recursive: true, force: true });
  const created = await createControlledChangeWorktree({ repositoryRoot: root, worktreePath: worktree, headSha: head });
  assert.equal(created.baseline_sha, head);
  const applied = await applyBoundedControlledChange({ worktreePath: worktree, runId: "run-1" });
  assert.equal(applied.relative_path, "DEVHARNESS_CONTROLLED_CHANGE.md");
  const committed = commitControlledChange({ worktreePath: worktree, message: "controlled change" });
  assert.match(committed.change_commit_sha, /^[0-9a-f]{40}$/);
  assert.notEqual(committed.change_commit_sha, head);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
  assert.equal(await readFile(path.join(worktree, "DEVHARNESS_CONTROLLED_CHANGE.md"), "utf8").then((v) => v.includes("run-1")), true);
  assert.equal(await readFile(path.join(root, "DEVHARNESS_CONTROLLED_CHANGE.md"), "utf8").then(() => false, () => true), true);
});

test("replace-in-file applies an exact single substitution", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-replace-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-replace-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  await mkdir(path.join(root, "backend", "src"), { recursive: true });
  await writeFile(path.join(root, "backend", "src", "main.py"), "async def health_check():\n    return {\"status\": \"healthy\"}\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "base"]);
  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const worktreePath = path.join(dataRoot, "change-worktree");
  await createControlledChangeWorktree({ repositoryRoot: root, worktreePath, headSha: head });
  const applied = await applyBoundedControlledChange({
    worktreePath,
    change: {
      kind: "replace-in-file",
      relative_path: "backend/src/main.py",
      old_string: "return {\"status\": \"healthy\"}\n",
      new_string: "return {\"status\": \"healthy\", \"service\": \"example-backend\"}\n"
    },
    runId: "run-replace-1"
  });
  assert.equal(applied.kind, "replace-in-file");
  const body = await readFile(path.join(worktreePath, "backend", "src", "main.py"), "utf8");
  assert.match(body, /example-backend/);
  assert.equal(await readFile(path.join(root, "backend", "src", "main.py"), "utf8").then((t) => t.includes("example-backend")), false);
});
