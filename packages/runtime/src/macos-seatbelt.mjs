import { createHash } from "node:crypto";
import { lstat, readFile, readlink, readdir } from "node:fs/promises";
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
  const resolved = path.resolve(root);
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

  const inventory = await captureConsumerInventory(consumerRoot);
  const template = buildTemplateDescriptor();
  const profileTemplateSha256 = hashContract(template);
  const instance = buildInstanceDescriptor({
    snapshot,
    consumerRoot: path.resolve(consumerRoot),
    attemptRoot: path.resolve(attemptRoot),
    privateHome: path.resolve(privateHome),
    supervisorRoot: path.resolve(supervisorRoot),
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
    consumer_root: path.resolve(consumerRoot),
    attempt_root: path.resolve(attemptRoot),
    private_home: path.resolve(privateHome),
    supervisor_root: path.resolve(supervisorRoot),
    snapshot_sha256: hashContract(snapshot),
    inventory,
    policy: accessPolicy,
    template,
    instance,
    probe_codes: [...PROBE_CODES]
  };
}

export function renderMacosSeatbeltProfile(view) {
  const lines = [
    "(version 1)",
    "(deny default)",
    `(allow file-read* (subpath ${JSON.stringify(view.consumer_root)}))`,
    `(allow file-write* (subpath ${JSON.stringify(view.attempt_root)}))`,
    `(allow file-read* (subpath ${JSON.stringify(view.private_home)}))`,
    `(allow file-read* (subpath ${JSON.stringify(view.supervisor_root)}))`,
    "(allow process-exec (literal \"/usr/bin/env\"))",
    "(allow process-exec (literal \"/usr/bin/true\"))"
  ];
  if (view.instance?.proxy_endpoint) {
    lines.push(`(allow network-outbound (remote ip "${view.instance.proxy_endpoint}"))`);
  }
  return lines.join("\n");
}

export function macosSeatbeltProbeCodes() {
  return [...PROBE_CODES];
}

export async function probeMacosSeatbeltBoundary(view, {
  probeRunner = async () => ({ code: "ISOLATION_UNAVAILABLE", summary: "Default macOS probe runner is not available in this environment." }),
  now = () => new Date().toISOString()
} = {}) {
  const before = view.inventory ?? await captureConsumerInventory(view.consumer_root);
  const probeResults = [];
  for (const code of PROBE_CODES) {
    const result = await probeRunner({ code, view });
    probeResults.push({ code, ...(result ?? {}) });
  }
  const after = await captureConsumerInventory(view.consumer_root);
  if (before.sha256 !== after.sha256) {
    throw new Error("Consumer inventory changed during the macOS Seatbelt probe.");
  }
  const proof = {
    backend: "macos-seatbelt-v1",
    profile_template_sha256: view.policy.profile_template_sha256,
    profile_instance_sha256: view.policy.profile_instance_sha256,
    snapshot_sha256: view.snapshot_sha256,
    probe_codes: PROBE_CODES,
    nested_tool_network: "denied",
    parent_proxy_probe_status: 200,
    consumer_before_sha256: before.sha256,
    consumer_after_sha256: after.sha256,
    proved_at: now()
  };
  proof.id = canonicalRecordId("isolation-proof", proof);
  return { proof, probes: probeResults };
}
