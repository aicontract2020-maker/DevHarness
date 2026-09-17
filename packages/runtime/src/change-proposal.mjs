import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { hashContract } from "../../project/src/harness.mjs";
import { runBoundedAgentWorker } from "./agent-worker.mjs";
import { runStoragePaths } from "./goal-run-store.mjs";
import {
  CODEX_ADAPTER_ID,
  LOCAL_READONLY_ADAPTER_ID,
  closeProviderProxy,
  defaultCodexProfile,
  prepareCodexExecutionContext,
  resolveAlignAgentSelection,
  resolveProviderCredential
} from "./codex-runtime.mjs";

export const CHANGE_PROPOSAL_PHASE = "change-proposal";

export const CHANGE_PROPOSAL_OUTPUT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "phase", "summary", "changes", "notes"],
  properties: {
    schema_version: { type: "integer", const: 1 },
    phase: { type: "string", const: CHANGE_PROPOSAL_PHASE },
    summary: { type: "string", minLength: 1, maxLength: 2000 },
    changes: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "relative_path", "contents"],
            properties: {
              kind: { type: "string", const: "ensure-file" },
              relative_path: { type: "string", minLength: 1, maxLength: 512 },
              contents: { type: "string" }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "relative_path", "old_string", "new_string"],
            properties: {
              kind: { type: "string", const: "replace-in-file" },
              relative_path: { type: "string", minLength: 1, maxLength: 512 },
              old_string: { type: "string", minLength: 1 },
              new_string: { type: "string" }
            }
          }
        ]
      }
    },
    notes: { type: "array", maxItems: 50, items: { type: "string", maxLength: 1000 } }
  }
});

function assertRelativePath(relative) {
  const value = String(relative ?? "").replace(/^\/+/, "");
  if (!value || value.includes("..") || path.isAbsolute(value)) {
    throw new Error(`Invalid change proposal path: ${relative}`);
  }
  return value;
}

/**
 * Validate agent JSON into a controlled-change spec ({ changes: [...] }).
 * Keeps agent output untrusted until this gate passes.
 */
export function validateChangeProposal(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new Error("Change proposal must be a JSON object.");
  }
  if (proposal.schema_version !== 1) throw new Error("Change proposal schema_version must be 1.");
  if (proposal.phase !== CHANGE_PROPOSAL_PHASE) {
    throw new Error(`Change proposal phase must be ${CHANGE_PROPOSAL_PHASE}.`);
  }
  if (typeof proposal.summary !== "string" || proposal.summary.trim().length < 1) {
    throw new Error("Change proposal summary is required.");
  }
  if (!Array.isArray(proposal.changes) || proposal.changes.length < 1 || proposal.changes.length > 20) {
    throw new Error("Change proposal must include 1..20 changes.");
  }
  const changes = [];
  for (const item of proposal.changes) {
    if (!item || typeof item !== "object") throw new Error("Each change must be an object.");
    const kind = item.kind;
    const relative_path = assertRelativePath(item.relative_path);
    if (kind === "ensure-file") {
      if (typeof item.contents !== "string") throw new Error(`ensure-file ${relative_path} requires string contents.`);
      changes.push({ kind, relative_path, contents: item.contents });
      continue;
    }
    if (kind === "replace-in-file") {
      if (typeof item.old_string !== "string" || item.old_string.length < 1) {
        throw new Error(`replace-in-file ${relative_path} requires non-empty old_string.`);
      }
      if (typeof item.new_string !== "string") {
        throw new Error(`replace-in-file ${relative_path} requires new_string.`);
      }
      changes.push({
        kind,
        relative_path,
        old_string: item.old_string,
        new_string: item.new_string
      });
      continue;
    }
    throw new Error(`Unsupported change kind in proposal: ${kind}`);
  }
  return {
    schema_version: 1,
    phase: CHANGE_PROPOSAL_PHASE,
    summary: proposal.summary.trim(),
    notes: Array.isArray(proposal.notes) ? proposal.notes.map(String) : [],
    changes
  };
}

export function changeSpecFromProposal(proposal) {
  const validated = validateChangeProposal(proposal);
  return { changes: validated.changes };
}

export async function writeChangeProposalOutputSchema(attemptRoot) {
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });
  const outputSchemaPath = path.join(attemptRoot, "output-schema.json");
  await writeFile(outputSchemaPath, `${JSON.stringify(CHANGE_PROPOSAL_OUTPUT_SCHEMA, null, 2)}\n`, "utf8");
  return outputSchemaPath;
}

function repositoryRootFromSnapshot(snapshot) {
  const rootUri = snapshot?.repository?.root_uri;
  if (!rootUri) throw new Error("Change proposal requires a repository snapshot.");
  return fileURLToPath(rootUri);
}

/**
 * Ask a read-only agent to propose a bounded controlled-change spec.
 * The agent must not mutate the consumer tree; runtime applies the validated spec later.
 */
export async function proposeControlledChangeWithAgent({
  snapshot,
  run,
  dataRoot,
  adapterRegistry,
  adapterName = null,
  agentProfileId = null,
  environment = process.env,
  providerCredential = null,
  startProviderProxy = undefined,
  probeRunner = async ({ code }) => ({ status: "pass", summary: code }),
  clock = () => new Date(),
  // Test seam: inject a finished proposal payload instead of running an adapter.
  fixtureProposal = null
} = {}) {
  if (!run?.id || !run?.goal) throw new Error("Change proposal requires a Goal Run.");
  if (!adapterRegistry) throw new Error("Change proposal requires an adapter registry.");

  const selection = await resolveAlignAgentSelection({
    requestedAgentId: adapterName,
    requestedProfileId: agentProfileId,
    environment
  });
  const resolvedAgentId = selection.agentId;
  if (resolvedAgentId === CODEX_ADAPTER_ID && selection.missing?.length) {
    throw new Error(`Codex is not ready for change proposal: missing ${selection.missing.join(", ")}.`);
  }

  const generatedAt = (clock()?.toISOString?.() ?? new Date().toISOString());
  const attemptId = `change-proposal-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const paths = runStoragePaths(dataRoot, snapshot.repository.identity, run.id);
  const root = path.join(paths.runRoot, "change-proposals", attemptId);
  await mkdir(root, { recursive: true, mode: 0o700 });

  const analysisRoot = repositoryRootFromSnapshot(snapshot);
  const resultPath = path.join(root, "result.json");
  const privateHome = path.join(root, "home");
  const supervisorRoot = path.join(root, "supervisor");
  const attemptTmpPath = path.join(root, "tmp");
  await mkdir(privateHome, { recursive: true, mode: 0o700 });
  await mkdir(supervisorRoot, { recursive: true, mode: 0o700 });
  await mkdir(attemptTmpPath, { recursive: true, mode: 0o700 });

  if (fixtureProposal) {
    const validated = validateChangeProposal(fixtureProposal);
    await writeFile(resultPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    return {
      agent_id: resolvedAgentId,
      attempt_id: attemptId,
      proposal: validated,
      change_spec: changeSpecFromProposal(validated),
      result_path: resultPath,
      proposal_sha256: hashContract(validated),
      generated_at: generatedAt
    };
  }

  const profile = defaultCodexProfile(environment);
  const modelId = resolvedAgentId === CODEX_ADAPTER_ID
    ? profile.modelId
    : "local-readonly-analysis";

  const invocation = {
    id: `invocation-${attemptId}`,
    operation_id: run.id,
    attempt_no: 1,
    phase: CHANGE_PROPOSAL_PHASE,
    execution_instance_id: `exec-change-proposal-${attemptId}`,
    adapter: { model_id: modelId },
    goal: {
      original: run.goal.original,
      refined: run.goal.refined ?? null,
      scope_version: run.goal.scope_version ?? 1
    },
    policy: {
      consumer: { write: false },
      allowed_change_kinds: ["ensure-file", "replace-in-file"],
      max_changes: 20
    },
    // Optional deterministic seed for local-readonly / tests
    fixture_change: run.fixture_change ?? null
  };

  let context = {
    analysisRoot,
    attemptTmpPath,
    privateHome,
    supervisorRoot,
    resultPath,
    outputSchemaPath: await writeChangeProposalOutputSchema(root),
    proxy: {
      port: 9,
      token: "unused-local",
      endpoint: null,
      tokenId: null,
      targetDescriptorSha256: hashContract({ adapterName: resolvedAgentId, kind: "target-descriptor" }),
      policySha256: hashContract({ adapterName: resolvedAgentId, kind: "proxy-policy" })
    }
  };
  let proxyServer = null;
  try {
    if (resolvedAgentId === CODEX_ADAPTER_ID) {
      const prepared = await prepareCodexExecutionContext({
        analysisRoot,
        attemptRoot: root,
        privateHome,
        supervisorRoot,
        resultPath,
        operationId: run.id,
        attemptId,
        environment,
        profile,
        providerCredential: providerCredential ?? resolveProviderCredential(environment)?.value ?? null,
        startProxy: startProviderProxy
      });
      // Keep change-proposal schema (prepareCodex writes analysis schema by default).
      await writeChangeProposalOutputSchema(root);
      context = {
        ...prepared.context,
        outputSchemaPath: path.join(root, "output-schema.json")
      };
      proxyServer = prepared.proxyServer;
    }

    const worker = await runBoundedAgentWorker({
      snapshot,
      adapterRegistry,
      adapterName: resolvedAgentId,
      invocation,
      workerContext: context,
      probeRunner,
      resultValidator: () => true,
      clock
    });

    if (worker.attempt.status !== "succeeded" || !worker.output?.result_path) {
      const detail = worker.output?.adapter_diagnostics?.[0]?.summary
        ?? worker.attempt.termination_reason
        ?? worker.attempt.status;
      throw new Error(`Change proposal agent failed: ${detail}`);
    }

    const raw = JSON.parse(await readFile(worker.output.result_path, "utf8"));
    const validated = validateChangeProposal(raw);
    await writeFile(path.join(root, "proposal.json"), `${JSON.stringify(validated, null, 2)}\n`, "utf8");

    return {
      agent_id: resolvedAgentId,
      attempt_id: attemptId,
      proposal: validated,
      change_spec: changeSpecFromProposal(validated),
      result_path: worker.output.result_path,
      proposal_sha256: hashContract(validated),
      generated_at: generatedAt,
      attempt: worker.attempt
    };
  } finally {
    await closeProviderProxy(proxyServer);
  }
}

export { LOCAL_READONLY_ADAPTER_ID, CODEX_ADAPTER_ID };
