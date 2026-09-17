import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentAdapterRegistry } from "../src/agent-adapter.mjs";
import {
  CHANGE_PROPOSAL_PHASE,
  changeSpecFromProposal,
  proposeControlledChangeWithAgent,
  validateChangeProposal
} from "../src/change-proposal.mjs";
import { discoverRepository } from "../../project/src/discover.mjs";
import { createLocalReadonlyAnalysisAdapter, LOCAL_READONLY_ADAPTER_ID } from "../../../adapters/agents/local-readonly/index.mjs";

async function fixtureRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-change-proposal-repo-"));
  await writeFile(path.join(root, "README.md"), "hi\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  return root;
}

test("validateChangeProposal accepts replace-in-file and ensure-file", () => {
  const proposal = validateChangeProposal({
    schema_version: 1,
    phase: CHANGE_PROPOSAL_PHASE,
    summary: "Add service identity",
    changes: [
      {
        kind: "replace-in-file",
        relative_path: "backend/src/main.py",
        old_string: 'return {"status": "healthy"}',
        new_string: 'return {"status": "healthy", "service": "aiedu-backend"}'
      },
      {
        kind: "ensure-file",
        relative_path: "notes/marker.md",
        contents: "ok\n"
      }
    ],
    notes: ["tiny"]
  });
  assert.equal(proposal.changes.length, 2);
  assert.deepEqual(changeSpecFromProposal(proposal), { changes: proposal.changes });
});

test("validateChangeProposal rejects path escape and unknown kinds", () => {
  assert.throws(() => validateChangeProposal({
    schema_version: 1,
    phase: CHANGE_PROPOSAL_PHASE,
    summary: "bad",
    changes: [{ kind: "replace-in-file", relative_path: "../etc/passwd", old_string: "a", new_string: "b" }],
    notes: []
  }), /Invalid change proposal path/);
  assert.throws(() => validateChangeProposal({
    schema_version: 1,
    phase: CHANGE_PROPOSAL_PHASE,
    summary: "bad",
    changes: [{ kind: "shell", relative_path: "x.sh", contents: "echo" }],
    notes: []
  }), /Unsupported change kind/);
});

test("proposeControlledChangeWithAgent accepts fixtureProposal without adapter call", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "dh-change-proposal-"));
  const repo = await fixtureRepo();
  t.after(() => Promise.all([
    rm(repo, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true })
  ]));
  const snapshot = await discoverRepository(repo);
  const result = await proposeControlledChangeWithAgent({
    snapshot,
    run: {
      id: "run-fixture-1",
      goal: { original: "Add a marker file", scope_version: 1 }
    },
    dataRoot,
    adapterRegistry: new AgentAdapterRegistry(),
    fixtureProposal: {
      schema_version: 1,
      phase: CHANGE_PROPOSAL_PHASE,
      summary: "fixture",
      changes: [{ kind: "ensure-file", relative_path: "AGENT.md", contents: "from fixture\n" }],
      notes: []
    }
  });
  assert.equal(result.change_spec.changes[0].relative_path, "AGENT.md");
  assert.equal(result.proposal_sha256.length, 64);
});

test("local-readonly adapter emits change-proposal payload", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "dh-change-proposal-local-"));
  const repo = await fixtureRepo();
  t.after(() => Promise.all([
    rm(repo, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true })
  ]));
  const snapshot = await discoverRepository(repo);
  const registry = new AgentAdapterRegistry();
  registry.register(LOCAL_READONLY_ADAPTER_ID, createLocalReadonlyAnalysisAdapter());
  const result = await proposeControlledChangeWithAgent({
    snapshot,
    run: {
      id: "run-local-propose-1",
      goal: { original: "Create agent proposed marker", scope_version: 1 }
    },
    dataRoot,
    adapterRegistry: registry,
    adapterName: LOCAL_READONLY_ADAPTER_ID,
    probeRunner: async ({ code }) => ({ status: "pass", summary: code })
  });
  assert.equal(result.agent_id, LOCAL_READONLY_ADAPTER_ID);
  assert.equal(result.change_spec.changes[0].kind, "ensure-file");
  assert.equal(result.change_spec.changes[0].relative_path, "DEVHARNESS_AGENT_PROPOSED_CHANGE.md");
});
