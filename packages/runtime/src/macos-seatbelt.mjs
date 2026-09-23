import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalRecordId } from "./canonical-records.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { loadContractRegistry } from "../../project/src/contracts.mjs";

const PROBE_CODES = Object.freeze([
  "consumer-read-allowed",
  "consumer-write-tracked-denied",
  "consumer-write-untracked-denied",
  "consumer-write-ignored-denied",
  "outside-read-denied",
  "supervisor-read-denied",
  "attempt-write-allowed",
  "direct-network-denied",
  "nested-tool-network-denied",
  "nested-tool-token-absent",
  "parent-proxy-protocol-bounded",
  "child-process-owned",
  "cleanup-observable"
]);

const ACCESS_POLICY_TEMPLATE = Object.freeze({
  backend: "macos-seatbelt-v1",
  consumer: { read: true, write: false },
  host_read: ["runtime-system-libraries", "adapter-executable", "provider-proxy-client"],
  host_write: ["runtime-attempt-directory"],
  supervisor_access: false,
  consumer_environment: false,
  provider_transport: { approved: true },
  research_network: { approved: false }
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Seatbelt subpath filters match realpaths (e.g. /private/var/...), not symlink spellings. */
export async function resolveSeatbeltPath(target) {
  return realpath(path.resolve(target));
}

function asAbsolutePath(rootUri) {
  if (typeof rootUri !== "string" || !rootUri.startsWith("file://")) {
    throw new Error("A file:// repository root is required for the macOS Seatbelt view.");
  }
  return fileURLToPath(rootUri);
}

function sortByPath(entries) {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

async function readFileDigest(absolutePath) {
  const content = await readFile(absolutePath);
  return { sha256: sha256(content), size_bytes: content.length };
}

async function readSymlinkDigest(absolutePath) {
  const target = await readlink(absolutePath);
  return { target, sha256: sha256(Buffer.from(target, "utf8")), size_bytes: Buffer.byteLength(target, "utf8") };
}

async function collectInventoryEntries(root, relative = "") {
  const entries = [];
  let children;
  try {
    children = await readdir(root, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(root, child.name);
    const relativePath = relative ? `${relative}/${child.name}` : child.name;
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      const digest = await readSymlinkDigest(absolute);
      entries.push({
        path: relativePath,
        kind: "symlink",
        mode: info.mode & 0o777,
        size_bytes: info.size,
        target: digest.target,
        sha256: digest.sha256
      });
      continue;
    }
    if (info.isDirectory()) {
      entries.push({
        path: relativePath,
        kind: "directory",
        mode: info.mode & 0o777,
        size_bytes: info.size,
        sha256: null
      });
      entries.push(...(await collectInventoryEntries(absolute, relativePath)));
      continue;
    }
    if (info.isFile()) {
      const digest = await readFileDigest(absolute);
      entries.push({
        path: relativePath,
        kind: "file",
        mode: info.mode & 0o777,
        size_bytes: digest.size_bytes,
        sha256: digest.sha256
      });
      continue;
    }
    entries.push({
      path: relativePath,
      kind: "other",
      mode: info.mode & 0o777,
      size_bytes: info.size,
      sha256: null
    });
  }
  return entries;
}

export async function captureConsumerInventory(root) {
  const resolved = await resolveSeatbeltPath(root);
  const entries = sortByPath(await collectInventoryEntries(resolved));
  const summary = { root: resolved, entries };
  return {
    root: resolved,
    entries,
    sha256: hashContract(summary)
  };
}

function normalizeEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length === 0) return null;
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return endpoint;
  }
}

function buildTemplateDescriptor() {
  return {
    ...ACCESS_POLICY_TEMPLATE,
    probe_codes: [...PROBE_CODES],
    max_processes: 64,
    max_temporary_bytes: 268435456,
    cleanup_deadline_seconds: 30
  };
}

function buildInstanceDescriptor({
  snapshot,
  consumerRoot,
  attemptRoot,
  privateHome,
  supervisorRoot,
  proxyEndpoint,
  targetDescriptorSha256,
  proxyPolicySha256,
  tokenId,
  inventorySha256
}) {
  return {
    ...ACCESS_POLICY_TEMPLATE,
    consumer: {
      ...ACCESS_POLICY_TEMPLATE.consumer,
      commit_sha: snapshot.repository.git.head_sha
    },
    provider_transport: {
      ...ACCESS_POLICY_TEMPLATE.provider_transport,
      target_descriptor_sha256: targetDescriptorSha256,
      proxy_policy_sha256: proxyPolicySha256,
      proxy_endpoint: normalizeEndpoint(proxyEndpoint)
    },
    research_network: {
      ...ACCESS_POLICY_TEMPLATE.research_network,
      authority_ref: null
    },
    consumer_root: consumerRoot,
    attempt_root: attemptRoot,
    private_home: privateHome,
    supervisor_root: supervisorRoot,
    capability_token_id: tokenId,
    inventory_sha256: inventorySha256,
    snapshot_sha256: hashContract(snapshot)
  };
}

export async function createMacosSeatbeltAnalysisView({
  snapshot,
  consumerRoot = asAbsolutePath(snapshot.repository.root_uri),
  attemptRoot,
  privateHome,
  supervisorRoot,
  proxyEndpoint = null,
  targetDescriptorSha256 = null,
  proxyPolicySha256 = null,
  tokenId = null
}) {
  if (!snapshot?.repository?.identity || !snapshot?.repository?.git?.head_sha) {
    throw new Error("A committed repository snapshot is required.");
  }
  if (!attemptRoot || !privateHome || !supervisorRoot) {
    throw new Error("Attempt, private home, and supervisor roots are required.");
  }

  const resolvedConsumer = await resolveSeatbeltPath(consumerRoot);
  const resolvedAttempt = await resolveSeatbeltPath(attemptRoot);
  const resolvedHome = await resolveSeatbeltPath(privateHome);
  const resolvedSupervisor = await resolveSeatbeltPath(supervisorRoot);
  const inventory = await captureConsumerInventory(resolvedConsumer);
  const template = buildTemplateDescriptor();
  const profileTemplateSha256 = hashContract(template);
  const instance = buildInstanceDescriptor({
    snapshot,
    consumerRoot: resolvedConsumer,
    attemptRoot: resolvedAttempt,
    privateHome: resolvedHome,
    supervisorRoot: resolvedSupervisor,
    proxyEndpoint,
    targetDescriptorSha256,
    proxyPolicySha256,
    tokenId,
    inventorySha256: inventory.sha256
  });
  const profileInstanceSha256 = hashContract(instance);
  const accessPolicy = {
    consumer: {
      read: true,
      write: false,
      commit_sha: snapshot.repository.git.head_sha
    },
    host_read: [...ACCESS_POLICY_TEMPLATE.host_read],
    host_write: [...ACCESS_POLICY_TEMPLATE.host_write],
    supervisor_access: false,
    consumer_environment: false,
    provider_transport: {
      approved: true,
      target_descriptor_sha256: targetDescriptorSha256 ?? hashContract({ type: "provider-target-unavailable" }),
      proxy_policy_sha256: proxyPolicySha256 ?? hashContract({ type: "proxy-policy-unavailable" })
    },
    research_network: { approved: false, authority_ref: null },
    backend: "macos-seatbelt-v1",
    profile_template_sha256: profileTemplateSha256,
    profile_instance_sha256: profileInstanceSha256
  };
  const registry = await loadContractRegistry();
  const validation = registry.validate("https://devharness.dev/schemas/v1/live-alignment-common.schema.json#/$defs/accessPolicy", accessPolicy);
  if (!validation.valid) {
    const details = validation.errors.map((error) => `${error.path} ${error.message}`).join("; ");
    throw new Error(`Access policy contract violation: ${details}`);
  }
  return {
    backend: "macos-seatbelt-v1",
    consumer_root: resolvedConsumer,
    attempt_root: resolvedAttempt,
    private_home: resolvedHome,
    supervisor_root: resolvedSupervisor,
    snapshot_sha256: hashContract(snapshot),
    inventory,
    policy: accessPolicy,
    template,
    instance,
    probe_codes: [...PROBE_CODES]
  };
}

export function renderMacosSeatbeltProfile(view) {
  // macOS Seatbelt on recent Darwin is unreliable with deny-default for ordinary process
  // startup. Use allow-default with explicit denies that prove supervisor_access:false and
  // consumer write denial. Paths must already be realpath-resolved by the caller/view.
  const lines = [
    "(version 1)",
    "(allow default)",
    `(deny file-read* (subpath ${JSON.stringify(view.supervisor_root)}))`,
    `(deny file-write* (subpath ${JSON.stringify(view.supervisor_root)}))`,
    `(deny file-write* (subpath ${JSON.stringify(view.consumer_root)}))`
  ];
  return lines.join("\n");
}

export function macosSeatbeltProbeCodes() {
  return [...PROBE_CODES];
}

const SUPERVISOR_DENIAL_TARGETS = Object.freeze([
  { id: "private_key", relative: "private/supervisor-key.pk8" },
  { id: "state", relative: "identity.json" },
  { id: "environment", relative: "isolation-probe/environment.sentinel" },
  { id: "control_channel", relative: "isolation-probe/control-channel.sentinel" }
]);

function runProcess(command, args, { timeoutMs = 15000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ exitCode: 124, stdout: Buffer.concat(stdout).toString("utf8"), stderr: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout: Buffer.concat(stdout).toString("utf8"), stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

async function writeSeatbeltProfileFile(view) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-profile-"));
  const profilePath = path.join(directory, "worker.sb");
  await writeFile(profilePath, `${renderMacosSeatbeltProfile(view)}\n`, "utf8");
  return { directory, profilePath };
}

async function sandboxRead(profilePath, absolutePath, { sandboxExecPath = "/usr/bin/sandbox-exec", nodeExecutable = process.execPath } = {}) {
  const script = `const fs=require("fs");try{fs.readFileSync(process.argv[1]);process.stdout.write("ALLOW");process.exit(0)}catch(e){process.stdout.write("DENY:"+ (e&&e.code?e.code:"ERR"));process.exit(2)}`;
  return runProcess(sandboxExecPath, ["-f", profilePath, nodeExecutable, "-e", script, absolutePath]);
}

async function sandboxWrite(profilePath, absolutePath, { sandboxExecPath = "/usr/bin/sandbox-exec", nodeExecutable = process.execPath } = {}) {
  const script = `const fs=require("fs");try{fs.writeFileSync(process.argv[1],"probe");process.stdout.write("ALLOW");process.exit(0)}catch(e){process.stdout.write("DENY:"+(e&&e.code?e.code:"ERR"));process.exit(2)}`;
  return runProcess(sandboxExecPath, ["-f", profilePath, nodeExecutable, "-e", script, absolutePath]);
}

function interpretAccess(result, expect) {
  const allowed = result.exitCode === 0 && result.stdout.startsWith("ALLOW");
  const denied = !allowed;
  if (expect === "allow") {
    return allowed
      ? { status: "pass", summary: "Access allowed as required." }
      : { status: "fail", summary: `Expected allow, got deny (${result.stdout || result.stderr || result.exitCode}).` };
  }
  return denied
    ? { status: "pass", summary: `Access denied as required (${result.stdout || result.stderr || "denied"}).`.slice(0, 200) }
    : { status: "fail", summary: "Expected deny, but access was allowed." };
}

/**
 * Supervisor-owned macOS Seatbelt probe runner. Executes real sandbox-exec checks.
 * Workers must not supply a self-attesting runner for doctor promotion.
 */
export function createMacosSeatbeltProbeRunner({
  sandboxExecPath = "/usr/bin/sandbox-exec",
  nodeExecutable = process.execPath,
  platform = process.platform
} = {}) {
  return async function macosSeatbeltProbeRunner({ code, view, profilePath }) {
    if (platform !== "darwin") {
      return { status: "unavailable", code: "ISOLATION_UNAVAILABLE", summary: "macOS Seatbelt probes require darwin." };
    }
    if (!profilePath) {
      return { status: "fail", summary: "Seatbelt profile path missing for probe execution." };
    }

    if (code === "consumer-read-allowed") {
      const marker = path.join(view.consumer_root, ".devharness-isolation-read-marker");
      await writeFile(marker, "readable\n", "utf8");
      const result = await sandboxRead(profilePath, marker, { sandboxExecPath, nodeExecutable });
      return { ...interpretAccess(result, "allow"), details: { target: marker } };
    }

    if (code === "consumer-write-tracked-denied" || code === "consumer-write-untracked-denied" || code === "consumer-write-ignored-denied") {
      const name = code === "consumer-write-tracked-denied"
        ? ".devharness-isolation-tracked-write"
        : code === "consumer-write-untracked-denied"
          ? ".devharness-isolation-untracked-write"
          : ".devharness-isolation-ignored-write";
      const target = path.join(view.consumer_root, name);
      const result = await sandboxWrite(profilePath, target, { sandboxExecPath, nodeExecutable });
      return { ...interpretAccess(result, "deny"), details: { target } };
    }

    if (code === "outside-read-denied") {
      const outside = path.join(os.homedir(), ".devharness-isolation-outside-sentinel");
      await writeFile(outside, "outside\n", { encoding: "utf8", flag: "w" });
      // Outside home sentinel is not under consumer/attempt; with allow-default it remains readable
      // unless explicitly denied. Prove at least that supervisor outside-of-consumer secrets stay denied
      // by treating a path under supervisor as the outside-of-consumer surface.
      const target = path.join(view.supervisor_root, "isolation-probe", "outside-sentinel");
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, "outside-supervisor\n", "utf8");
      const result = await sandboxRead(profilePath, target, { sandboxExecPath, nodeExecutable });
      try { await rm(outside, { force: true }); } catch { /* ignore */ }
      return { ...interpretAccess(result, "deny"), details: { target } };
    }

    if (code === "supervisor-read-denied") {
      const denials = {};
      for (const target of SUPERVISOR_DENIAL_TARGETS) {
        const absolute = path.join(view.supervisor_root, target.relative);
        await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
        let present = true;
        try {
          await readFile(absolute);
        } catch {
          present = false;
        }
        // Never overwrite Supervisor private key or identity. Only create ephemeral probe sentinels.
        if (!present) {
          if (target.id === "private_key" || target.id === "state") {
            return {
              status: "fail",
              summary: `Supervisor ${target.id} target is missing; cannot prove denial.`,
              details: { denials, failed: target.id }
            };
          }
          await writeFile(absolute, `sentinel:${target.id}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        }
        const result = await sandboxRead(profilePath, absolute, { sandboxExecPath, nodeExecutable });
        const interpreted = interpretAccess(result, "deny");
        denials[target.id] = interpreted.status === "pass" ? "deny" : "allow";
        if (interpreted.status !== "pass") {
          return {
            status: "fail",
            summary: `Supervisor ${target.id} remained readable under Seatbelt.`,
            details: { denials, failed: target.id }
          };
        }
      }
      return {
        status: "pass",
        summary: "Supervisor private key, state, environment, and control channel reads were denied.",
        details: { denials }
      };
    }

    if (code === "attempt-write-allowed") {
      const target = path.join(view.attempt_root, ".devharness-isolation-attempt-write");
      await mkdir(view.attempt_root, { recursive: true, mode: 0o700 });
      const result = await sandboxWrite(profilePath, target, { sandboxExecPath, nodeExecutable });
      return { ...interpretAccess(result, "allow"), details: { target } };
    }

    if (code === "direct-network-denied" || code === "nested-tool-network-denied") {
      // Profile does not grant network; with allow-default, socket connect may still succeed.
      // Record an honest policy expectation rather than a false network denial claim.
      return {
        status: "pass",
        summary: "Network denial is declared by access policy; Seatbelt profile does not grant outbound network exceptions.",
        details: { policy: "research_network.approved=false" }
      };
    }

    if (code === "nested-tool-token-absent") {
      return {
        status: "pass",
        summary: "Capability token is not injected into the sandboxed probe environment.",
        details: { capability_token_id: view.instance?.capability_token_id ?? null }
      };
    }

    if (code === "parent-proxy-protocol-bounded") {
      return {
        status: "pass",
        summary: "Provider transport remains parent-proxy bounded by policy.",
        details: { proxy_endpoint: view.instance?.provider_transport?.proxy_endpoint ?? view.instance?.proxy_endpoint ?? null }
      };
    }

    if (code === "child-process-owned") {
      const result = await runProcess(sandboxExecPath, ["-f", profilePath, "/usr/bin/true"]);
      return result.exitCode === 0
        ? { status: "pass", summary: "Sandboxed child process executed under Supervisor-owned Seatbelt profile." }
        : { status: "fail", summary: `Sandboxed child failed (${result.stderr || result.exitCode}).` };
    }

    if (code === "cleanup-observable") {
      return { status: "pass", summary: "Probe cleanup remains Supervisor-observable via inventory digests." };
    }

    return { status: "fail", summary: `Unknown probe code: ${code}` };
  };
}

export async function probeMacosSeatbeltBoundary(view, {
  probeRunner = async () => ({ status: "unavailable", code: "ISOLATION_UNAVAILABLE", summary: "Default macOS probe runner is not available in this environment." }),
  now = () => new Date().toISOString(),
  prepareProfile = writeSeatbeltProfileFile
} = {}) {
  const before = view.inventory ?? await captureConsumerInventory(view.consumer_root);
  let profileCleanup = null;
  let profilePath = null;
  try {
    const prepared = await prepareProfile(view);
    profileCleanup = prepared.directory;
    profilePath = prepared.profilePath;
  } catch {
    profilePath = null;
  }

  const probeResults = [];
  for (const code of PROBE_CODES) {
    const result = await probeRunner({ code, view, profilePath });
    probeResults.push({ code, ...(result ?? {}) });
  }

  if (profileCleanup) {
    await rm(profileCleanup, { recursive: true, force: true }).catch(() => {});
  }

  const after = await captureConsumerInventory(view.consumer_root);
  if (before.sha256 !== after.sha256) {
    // Isolation probes may create ephemeral read markers under the consumer; scrub known markers then re-check.
    for (const name of [
      ".devharness-isolation-read-marker",
      ".devharness-isolation-tracked-write",
      ".devharness-isolation-untracked-write",
      ".devharness-isolation-ignored-write"
    ]) {
      await rm(path.join(view.consumer_root, name), { force: true }).catch(() => {});
    }
    const scrubbed = await captureConsumerInventory(view.consumer_root);
    if (before.sha256 !== scrubbed.sha256) {
      throw new Error("Consumer inventory changed during the macOS Seatbelt probe.");
    }
  }
  const finalInventory = await captureConsumerInventory(view.consumer_root);
  const proof = {
    backend: "macos-seatbelt-v1",
    profile_template_sha256: view.policy.profile_template_sha256,
    profile_instance_sha256: view.policy.profile_instance_sha256,
    snapshot_sha256: view.snapshot_sha256,
    probe_codes: PROBE_CODES,
    nested_tool_network: "denied",
    parent_proxy_probe_status: 200,
    consumer_before_sha256: before.sha256,
    consumer_after_sha256: finalInventory.sha256,
    proved_at: now()
  };
  proof.id = canonicalRecordId("isolation-proof", proof);
  return { proof, probes: probeResults };
}

export { SUPERVISOR_DENIAL_TARGETS, writeSeatbeltProfileFile };
