import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  defaultPromoteBranchName,
  promoteControlledChange,
  promoteSupported
} from "../src/promote-change.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-promote-repo-"));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  await writeFile(path.join(root, "README.md"), "base\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "base"]);
  const baseline = git(root, ["rev-parse", "HEAD"]);
  await writeFile(path.join(root, "DEVHARNESS_CONTROLLED_CHANGE.md"), "marker\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "change"]);
  const change = git(root, ["rev-parse", "HEAD"]);
  execFileSync("git", ["-C", root, "checkout", "-q", baseline]);
  return { root, baseline, change };
}

test("promote creates a local branch without moving HEAD or dirtying checkout", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-promote-data-"));
  const { root, baseline, change } = await makeRepo();
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true })
  ]));

  const run = {
    id: "run-promote-1",
    state: "completed",
    current_head_sha: baseline,
    repository: { identity: "example/project", base_ref: "main" },
    gates: { delivery: { status: "approved" }, scope: { status: "approved" } }
  };
  const readiness = {
    delivery_mode: "controlled-change",
    head_sha: baseline,
    change_commit_sha: change,
    change_path: "DEVHARNESS_CONTROLLED_CHANGE.md"
  };
  assert.equal(promoteSupported({ run, readiness }).ok, true);

  const record = await promoteControlledChange({
    repositoryRoot: root,
    dataRoot,
    repositoryIdentity: "example/project",
    run,
    readiness,
    branchName: defaultPromoteBranchName(run.id),
    push: false,
    createPr: false,
    generatedAt: "2026-09-16T20:00:00.000Z"
  });

  assert.equal(record.branch, "dogfood/devharness-promote-promote-1");
  assert.equal(record.change_commit_sha, change);
  assert.equal(record.pushed, false);
  assert.equal(record.pr_url, null);
  assert.equal(git(root, ["rev-parse", "HEAD"]), baseline);
  assert.equal(git(root, ["rev-parse", `refs/heads/${record.branch}`]), change);
  assert.equal(git(root, ["status", "--porcelain=v1"]), "");
  assert.equal(await import("node:fs/promises").then((fs) => fs.access(path.join(root, "DEVHARNESS_CONTROLLED_CHANGE.md")).then(() => "present", () => "absent")), "absent");
});

test("promote refuses docs-only and incomplete runs", () => {
  const run = {
    id: "run-x",
    state: "verifying",
    current_head_sha: "a".repeat(40),
    repository: { identity: "example/project", base_ref: "main" },
    gates: { delivery: { status: "pending" }, scope: { status: "approved" } }
  };
  assert.equal(promoteSupported({ run, readiness: { delivery_mode: "docs-only", change_commit_sha: "b".repeat(40) } }).ok, false);
});
