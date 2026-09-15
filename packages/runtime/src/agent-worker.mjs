import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { hashContract } from "../../project/src/harness.mjs";
import { promoteUntrustedOutput } from "./untrusted-output.mjs";
import { captureConsumerInventory, createMacosSeatbeltAnalysisView, probeMacosSeatbeltBoundary } from "./macos-seatbelt.mjs";

const ONE_MB = 1024 * 1024;

function nowIso(clock) {
  return clock().toISOString();
}

function durationMs(startedAt, completedAt) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function defaultCleanupProof(startedAt, completedAt, proofSeed) {
  return {
    status: "complete",
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs(startedAt, completedAt),
    remaining_processes: 0,
    temporary_paths_remaining: 0,
    proof_sha256: hashContract({ started_at: startedAt, completed_at: completedAt, proof_seed: proofSeed })
  };
}

async function readMaybe(file) {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

export async function runBoundedAgentWorker({
  snapshot,
  adapterRegistry,
  adapterName,
  invocation,
  workerContext,
  probeRunner,
  resultValidator,
  cleanup = async ({ startedAt, completedAt, proofSeed }) => defaultCleanupProof(startedAt, completedAt, proofSeed),
  clock = () => new Date(),
  maxResultBytes = ONE_MB
}) {
  if (!snapshot?.repository?.root_uri) throw new Error("A live snapshot is required.");
  if (!adapterRegistry) throw new Error("An adapter registry is required.");
  if (!adapterName) throw new Error("An adapter name is required.");
  if (!invocation || typeof invocation !== "object") throw new Error("An invocation is required.");
  if (!workerContext?.analysisRoot || !workerContext?.attemptTmpPath || !workerContext?.privateHome || !workerContext?.supervisorRoot) {
    throw new Error("Worker context requires analysisRoot, attemptTmpPath, privateHome, and supervisorRoot.");
  }

  const startedAt = nowIso(clock);
  const analysisView = await createMacosSeatbeltAnalysisView({
    snapshot,
    consumerRoot: workerContext.analysisRoot,
    attemptRoot: workerContext.attemptTmpPath,
    privateHome: workerContext.privateHome,
    supervisorRoot: workerContext.supervisorRoot,
    proxyEndpoint: workerContext.proxy?.endpoint ?? null,
    targetDescriptorSha256: workerContext.proxy?.targetDescriptorSha256 ?? hashContract({ adapterName, kind: "target-descriptor" }),
    proxyPolicySha256: workerContext.proxy?.policySha256 ?? hashContract({ adapterName, kind: "proxy-policy" }),
    tokenId: workerContext.proxy?.tokenId ?? null
  });
  const beforeInventory = analysisView.inventory ?? await captureConsumerInventory(workerContext.analysisRoot);
  const { proof: isolationProof } = await probeMacosSeatbeltBoundary(analysisView, { probeRunner, now: () => nowIso(clock) });

  let output;
  try {
    output = await adapterRegistry.start(adapterName, { invocation, executionContext: workerContext });
  } catch (error) {
    const completedAt = nowIso(clock);
    const cleanupStartedAt = completedAt;
    const cleanupProof = await cleanup({ startedAt: cleanupStartedAt, completedAt, proofSeed: "adapter-start-failed" });
    return {
      attempt: {
        schema_version: 1,
        id: `attempt-${hashContract({ invocation: invocation.id, completedAt }).slice(0, 32)}`,
        operation_id: invocation.operation_id,
        invocation_id: invocation.id,
        attempt_no: invocation.attempt_no,
        phase: invocation.phase,
        execution_instance_id: invocation.execution_instance_id,
        status: "failed",
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs(startedAt, completedAt),
        termination_reason: error.code === "ISOLATION_UNAVAILABLE" ? "isolation" : "process-exit",
        exit_code: null,
        limit_observations: {
          wall_ms: durationMs(startedAt, completedAt),
          stdout_bytes: 0,
          stderr_bytes: 0,
          result_bytes: 0,
          retained_records: 0,
          retained_bytes: 0,
          temporary_bytes_peak: 0,
          process_peak: 0,
          rss_bytes_peak: 0,
          provider_requests: 0,
          total_tokens: 0
        },
        artifacts: [],
        cleanup: cleanupProof,
        isolation_proof_sha256: hashContract(isolationProof),
        profile_instance_sha256: analysisView.policy.profile_instance_sha256
      },
      output: null,
      isolationProof,
      inventory: { before: beforeInventory, after: beforeInventory }
    };
  }

  const afterInventory = await captureConsumerInventory(workerContext.analysisRoot);
  if (beforeInventory.sha256 !== afterInventory.sha256) {
    const completedAt = nowIso(clock);
    const cleanupProof = await cleanup({ startedAt: completedAt, completedAt, proofSeed: "consumer-mutation" });
    return {
      attempt: {
        schema_version: 1,
        id: `attempt-${hashContract({ invocation: invocation.id, completedAt }).slice(0, 32)}`,
        operation_id: invocation.operation_id,
        invocation_id: invocation.id,
        attempt_no: invocation.attempt_no,
        phase: invocation.phase,
        execution_instance_id: invocation.execution_instance_id,
        status: "failed",
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs(startedAt, completedAt),
        termination_reason: "integrity",
        exit_code: null,
        limit_observations: {
          wall_ms: durationMs(startedAt, completedAt),
          stdout_bytes: 0,
          stderr_bytes: 0,
          result_bytes: 0,
          retained_records: 0,
          retained_bytes: 0,
          temporary_bytes_peak: 0,
          process_peak: 0,
          rss_bytes_peak: 0,
          provider_requests: 0,
          total_tokens: 0
        },
        artifacts: [],
        cleanup: cleanupProof,
        isolation_proof_sha256: hashContract(isolationProof),
        profile_instance_sha256: analysisView.policy.profile_instance_sha256
      },
      output,
      isolationProof,
      inventory: { before: beforeInventory, after: afterInventory }
    };
  }

  let resultSha256 = null;
  let resultBytes = 0;
  if (output.status === "succeeded" && output.result_path) {
    const raw = await readMaybe(output.result_path);
    if (!raw) {
      const completedAt = nowIso(clock);
      const cleanupProof = await cleanup({ startedAt: completedAt, completedAt, proofSeed: "missing-result" });
      return {
        attempt: {
          schema_version: 1,
          id: `attempt-${hashContract({ invocation: invocation.id, completedAt }).slice(0, 32)}`,
          operation_id: invocation.operation_id,
          invocation_id: invocation.id,
          attempt_no: invocation.attempt_no,
          phase: invocation.phase,
          execution_instance_id: invocation.execution_instance_id,
          status: "failed",
          started_at: startedAt,
          completed_at: completedAt,
          duration_ms: durationMs(startedAt, completedAt),
          termination_reason: "invalid-output",
          exit_code: null,
          limit_observations: {
            wall_ms: durationMs(startedAt, completedAt),
            stdout_bytes: 0,
            stderr_bytes: 0,
            result_bytes: 0,
            retained_records: 0,
            retained_bytes: 0,
            temporary_bytes_peak: 0,
            process_peak: 0,
            rss_bytes_peak: 0,
            provider_requests: 0,
            total_tokens: 0
          },
          artifacts: [],
          cleanup: cleanupProof,
          isolation_proof_sha256: hashContract(isolationProof),
          profile_instance_sha256: analysisView.policy.profile_instance_sha256
        },
        output,
        isolationProof,
        inventory: { before: beforeInventory, after: afterInventory }
      };
    }
    const promotion = await promoteUntrustedOutput({ rawBytes: raw, validate: resultValidator, credentialValues: [workerContext.proxy?.token].filter(Boolean), maxBytes: maxResultBytes });
    resultSha256 = promotion.sha256;
    resultBytes = promotion.canonicalBytes.byteLength;
  }

  const completedAt = nowIso(clock);
  const cleanupStartedAt = completedAt;
  const cleanupProof = await cleanup({ startedAt: cleanupStartedAt, completedAt, proofSeed: resultSha256 ?? output.termination_reason });
  const limitObservations = {
    wall_ms: durationMs(startedAt, completedAt),
    stdout_bytes: 0,
    stderr_bytes: 0,
    result_bytes: resultBytes,
    retained_records: 0,
    retained_bytes: 0,
    temporary_bytes_peak: 0,
    process_peak: 0,
    rss_bytes_peak: 0,
    provider_requests: 0,
    total_tokens: output.usage?.total_tokens ?? 0
  };
  const attempt = {
    schema_version: 1,
    id: `attempt-${hashContract({ invocation: invocation.id, completedAt, resultSha256 }).slice(0, 32)}`,
    operation_id: invocation.operation_id,
    invocation_id: invocation.id,
    attempt_no: invocation.attempt_no,
    phase: invocation.phase,
    execution_instance_id: invocation.execution_instance_id,
    status: output.status,
    started_at: output.started_at ?? startedAt,
    completed_at: output.completed_at ?? completedAt,
    duration_ms: durationMs(output.started_at ?? startedAt, output.completed_at ?? completedAt),
    termination_reason: output.termination_reason,
    exit_code: output.exit_code,
    limit_observations: limitObservations,
    artifacts: [],
    cleanup: cleanupProof,
    isolation_proof_sha256: hashContract(isolationProof),
    profile_instance_sha256: analysisView.policy.profile_instance_sha256,
    ...(resultSha256 ? { result_sha256: resultSha256 } : {}),
    ...(output.usage ? { usage: output.usage } : {})
  };
  return {
    attempt,
    output,
    isolationProof,
    inventory: { before: beforeInventory, after: afterInventory },
    analysisView
  };
}
