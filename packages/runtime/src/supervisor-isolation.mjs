import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { hashContract } from "../../project/src/harness.mjs";
import {
  createMacosSeatbeltAnalysisView,
  createMacosSeatbeltProbeRunner,
  probeMacosSeatbeltBoundary
} from "./macos-seatbelt.mjs";
import {
  attestIsolationProof,
  loadSupervisorIdentity,
  writeIsolationProof
} from "./supervisor-store.mjs";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pathDigest(absolutePath) {
  return sha256Text(path.resolve(absolutePath));
}

/**
 * Host-scoped Supervisor isolation proof.
 *
 * Isolation is a property of the Supervisor runtime boundary on this machine, not of a
 * consumer repository revision. Proofs are therefore host-scoped and bound to the pinned
 * Supervisor identity rather than a consumer commit SHA.
 */
export async function issueSupervisorIsolationProof({
  supervisorRoot,
  consumerRoot = null,
  attemptRoot = null,
  privateHome = null,
  probeRunner = null,
  platform = process.platform,
  now = () => new Date(),
  ttlMs = DEFAULT_TTL_MS,
  hostname = os.hostname()
} = {}) {
  if (!supervisorRoot) throw new Error("supervisorRoot is required for isolation proof issuance.");
  if (platform !== "darwin") {
    throw new Error("Supervisor isolation proof currently requires macOS Seatbelt (darwin).");
  }

  const identity = await loadSupervisorIdentity(supervisorRoot);
  const provedAt = now();
  const provedAtIso = provedAt.toISOString();
  const expiresAtIso = new Date(provedAt.getTime() + ttlMs).toISOString();

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-isolation-issue-"));
  const resolvedConsumer = consumerRoot ?? path.join(tempRoot, "consumer");
  const resolvedAttempt = attemptRoot ?? path.join(tempRoot, "attempt");
  const resolvedHome = privateHome ?? path.join(tempRoot, "home");
  await mkdir(resolvedConsumer, { recursive: true, mode: 0o700 });
  await mkdir(resolvedAttempt, { recursive: true, mode: 0o700 });
  await mkdir(resolvedHome, { recursive: true, mode: 0o700 });
  await writeFile(path.join(resolvedConsumer, "README.isolation"), "isolation-consumer\n", "utf8");

  // Ensure Supervisor probe sentinels exist under the real supervisor root (Supervisor-owned).
  await mkdir(path.join(supervisorRoot, "isolation-probe"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(supervisorRoot, "isolation-probe", "environment.sentinel"), "environment\n", { encoding: "utf8", mode: 0o600 });
  await writeFile(path.join(supervisorRoot, "isolation-probe", "control-channel.sentinel"), "control\n", { encoding: "utf8", mode: 0o600 });

  const snapshot = {
    schema_version: 1,
    captured_at: provedAtIso,
    repository: {
      name: "supervisor-isolation-host",
      root_uri: pathToFileURL(resolvedConsumer).href,
      identity: "devharness/supervisor-isolation-host",
      git: {
        is_repository: true,
        head_sha: "0".repeat(40),
        branch: "isolation",
        dirty: false,
        changed_file_count: 0,
        remote_hosts: []
      }
    },
    inventory: { file_count: 1, manifests: [], lockfiles: [] },
    detected: {
      platforms: ["cli"],
      languages: [],
      frameworks: [],
      package_managers: [],
      services: [],
      test_tools: [],
      ci_files: [],
      deployment_files: [],
      agent_files: []
    },
    commands: [],
    environment: { example_files: [], local_files: [], declared_keys: [], locally_set_keys: [], local_files_ignored: true },
    submodules: []
  };

  const view = await createMacosSeatbeltAnalysisView({
    snapshot,
    consumerRoot: resolvedConsumer,
    attemptRoot: resolvedAttempt,
    privateHome: resolvedHome,
    supervisorRoot,
    proxyEndpoint: null,
    targetDescriptorSha256: hashContract({ kind: "isolation-target" }),
    proxyPolicySha256: hashContract({ kind: "isolation-proxy-policy" }),
    tokenId: null
  });

  const runner = probeRunner ?? createMacosSeatbeltProbeRunner({ platform });
  const { proof: boundaryProof, probes } = await probeMacosSeatbeltBoundary(view, {
    probeRunner: runner,
    now: () => provedAtIso
  });

  const supervisorProbe = probes.find((item) => item.code === "supervisor-read-denied");
  const denials = supervisorProbe?.details?.denials ?? {};
  const required = {
    private_key: denials.private_key === "deny" ? "deny" : null,
    state: denials.state === "deny" ? "deny" : null,
    environment: denials.environment === "deny" ? "deny" : null,
    control_channel: denials.control_channel === "deny" ? "deny" : null
  };
  const requiredComplete = Object.values(required).every((value) => value === "deny");
  const probesOk = probes.every((item) => item.status === "pass");
  const passed = requiredComplete && probesOk && supervisorProbe?.status === "pass";

  if (!passed) {
    const failed = probes.filter((item) => item.status !== "pass").map((item) => item.code);
    throw new Error(
      `Supervisor isolation probe failed (${failed.join(", ") || "required denials incomplete"}). Doctor stays fail-closed.`
    );
  }

  const seed = hashContract({
    fingerprint: identity.fingerprint,
    backend: "macos-seatbelt-v1",
    profile_template_sha256: view.policy.profile_template_sha256,
    profile_instance_sha256: view.policy.profile_instance_sha256,
    required,
    proved_at: provedAtIso
  });

  const payload = {
    schema_version: 1,
    id: `isolation-proof-${seed.slice(0, 24)}`,
    scope: "host",
    host: {
      platform,
      arch: process.arch,
      hostname_sha256: sha256Text(hostname)
    },
    supervisor: { id: identity.id, fingerprint: identity.fingerprint },
    backend: "macos-seatbelt-v1",
    profile_template_sha256: view.policy.profile_template_sha256,
    profile_instance_sha256: view.policy.profile_instance_sha256,
    required_denials: required,
    probes: probes.map((item) => ({
      code: item.code,
      status: item.status,
      summary: item.summary,
      ...(item.details ? { details: item.details } : {})
    })),
    boundary: {
      supervisor_root_sha256: pathDigest(view.supervisor_root),
      consumer_root_sha256: pathDigest(view.consumer_root),
      attempt_root_sha256: pathDigest(view.attempt_root),
      proof_id: boundaryProof.id,
      proof_sha256: hashContract(boundaryProof)
    },
    proved_at: provedAtIso,
    expires_at: expiresAtIso,
    outcome: {
      status: "pass",
      summary: "macOS Seatbelt denied worker reads of Supervisor private key, state, environment, and control channel."
    },
    issuer: { id: identity.id, fingerprint: identity.fingerprint }
  };

  const signed = await attestIsolationProof(supervisorRoot, payload);
  const stored = await writeIsolationProof(supervisorRoot, signed);
  return { proof: signed, written: stored.written, path: stored.path, probes, boundaryProof };
}

export function isolationProofSatisfiesDoctor(proof, { identity, now = new Date() } = {}) {
  if (!proof || proof.scope !== "host" || proof.backend !== "macos-seatbelt-v1") return false;
  if (proof.outcome?.status !== "pass") return false;
  if (!identity || proof.supervisor?.fingerprint !== identity.fingerprint || proof.supervisor?.id !== identity.id) return false;
  if (Date.parse(proof.expires_at) < (now instanceof Date ? now.getTime() : Date.parse(now))) return false;
  const denials = proof.required_denials ?? {};
  if (![denials.private_key, denials.state, denials.environment, denials.control_channel].every((value) => value === "deny")) {
    return false;
  }
  const supervisorProbe = (proof.probes ?? []).find((item) => item.code === "supervisor-read-denied");
  return supervisorProbe?.status === "pass";
}
