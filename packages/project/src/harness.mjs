import { createHash } from "node:crypto";

import { assertContract } from "./contracts.mjs";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashContract(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function assertSafeReadiness(readiness) {
  let target;
  try {
    target = new URL(readiness.url);
  } catch {
    throw new Error(`Unsafe readiness target: ${readiness.url}`);
  }
  const hostname = target.hostname.toLowerCase();
  const loopback = hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/.test(hostname);
  const kind = readiness.kind ?? "http";
  if (kind === "tcp") {
    if (
      target.protocol !== "tcp:" ||
      !loopback ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      !target.port
    ) {
      throw new Error(`Unsafe readiness target: ${readiness.url}. v0 TCP readiness permits credential-free loopback tcp://host:port URLs.`);
    }
  } else if (kind === "http") {
    if (
      target.protocol !== "http:" ||
      !loopback ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    ) {
      throw new Error(`Unsafe readiness target: ${readiness.url}. v0 permits credential-free loopback HTTP URLs without query strings or fragments.`);
    }
  } else {
    throw new Error(`Unsupported readiness kind: ${kind}`);
  }
  for (const check of readiness.additional_checks ?? []) assertSafeReadiness(check);
  return readiness;
}

function uniqueBy(values, key, label) {
  const seen = new Set();
  for (const value of values) {
    const id = value[key];
    if (seen.has(id)) throw new Error(`Duplicate ${label}: ${id}`);
    seen.add(id);
  }
}

function resolvedCommand(command) {
  return { ...command, sha256: hashContract(command) };
}

export async function compileProjectHarness(snapshot, config, options = {}) {
  await assertContract("project-config", config);
  if (!snapshot.repository.git.is_repository || !snapshot.repository.git.head_sha) {
    throw new Error("Harness compilation requires a committed Git revision.");
  }
  if (snapshot.repository.git.dirty && !options.allowDirtyBaseline) {
    throw new Error("Harness compilation requires a clean committed baseline.");
  }

  const harnessConfig = config.harness ?? { services: [], verifications: [] };
  uniqueBy(config.quality.commands, "id", "configured command id");
  uniqueBy(harnessConfig.services, "id", "service id");
  uniqueBy(harnessConfig.verifications, "command_id", "verification command reference");

  const commands = config.quality.commands
    .map(resolvedCommand)
    .sort((left, right) => left.id.localeCompare(right.id));
  const commandsById = new Map(commands.map((command) => [command.id, command]));

  const services = harnessConfig.services.map((service) => {
    const command = commandsById.get(service.command_id);
    if (!command) throw new Error(`Service ${service.id} references unknown command: ${service.command_id}`);
    if (command.kind !== "launch") throw new Error(`Service ${service.id} must reference a launch command: ${service.command_id}`);
    assertSafeReadiness(service.readiness);
    const resolved = {
      id: service.id,
      command,
      readiness: service.readiness,
      shutdown: service.shutdown
    };
    return { ...resolved, sha256: hashContract(resolved) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const servicesById = new Map(services.map((service) => [service.id, service]));

  const verifications = harnessConfig.verifications.map((verification) => {
    const command = commandsById.get(verification.command_id);
    if (!command) throw new Error(`Verification references unknown command: ${verification.command_id}`);
    if (command.kind !== "verify" && command.kind !== "test") {
      throw new Error(`Verification must reference a verify or test command: ${verification.command_id}`);
    }
    for (const serviceId of verification.service_ids) {
      if (!servicesById.has(serviceId)) {
        throw new Error(`Verification ${verification.command_id} references unknown service: ${serviceId}`);
      }
    }
    const warmup = verification.warmup ?? [];
    for (const check of warmup) assertSafeReadiness(check);
    const resolved = { command, service_ids: [...verification.service_ids], warmup };
    return { ...resolved, sha256: hashContract(resolved) };
  }).sort((left, right) => left.command.id.localeCompare(right.command.id));

  const configuredLaunchIds = new Set(services.map((service) => service.command.id));
  const configuredVerificationIds = new Set(verifications.map((verification) => verification.command.id));
  const interactive = config.platforms.some((platform) => ["web", "mobile", "desktop"].includes(platform));
  const blockers = [
    ...commands
      .filter((command) => command.kind === "launch" && !configuredLaunchIds.has(command.id))
      .map((command) => ({
        code: "service-lifecycle-unconfigured",
        subject: command.id,
        summary: `Launch command ${command.id} has no explicit service readiness declaration.`
      })),
    ...commands
      .filter((command) => command.kind === "verify" && !configuredVerificationIds.has(command.id))
      .map((command) => ({
        code: "behavior-verification-unconfigured",
        subject: command.id,
        summary: `Verify command ${command.id} is not declared as a harness verification job.`
      })),
    ...verifications
      .filter((verification) => interactive && verification.service_ids.length === 0)
      .map((verification) => ({
        code: "interactive-verification-unbound",
        subject: verification.command.id,
        summary: `Interactive verification ${verification.command.id} is not bound to an owned service lifecycle.`
      }))
  ].sort((left, right) => left.code.localeCompare(right.code) || left.subject.localeCompare(right.subject));

  const body = {
    schema_version: 1,
    repository_identity: snapshot.repository.identity,
    commit_sha: snapshot.repository.git.head_sha,
    config_sha256: hashContract(config),
    packs: [...config.platforms].sort(),
    commands,
    services,
    verifications,
    blockers
  };
  const manifest = { ...body, id: `harness-${hashContract(body).slice(0, 32)}` };
  const orderedManifest = {
    schema_version: manifest.schema_version,
    id: manifest.id,
    repository_identity: manifest.repository_identity,
    commit_sha: manifest.commit_sha,
    config_sha256: manifest.config_sha256,
    packs: manifest.packs,
    commands: manifest.commands,
    services: manifest.services,
    verifications: manifest.verifications,
    blockers: manifest.blockers
  };
  await assertContract("project-harness", orderedManifest);
  return orderedManifest;
}

export function formatProjectHarness(manifest, targetPath) {
  const lines = [
    "DevHarness Project Harness",
    `Harness: ${manifest.id}`,
    `Repository: ${manifest.repository_identity}`,
    `Revision: ${manifest.commit_sha}`,
    `Packs: ${manifest.packs.join(", ")}`,
    `Commands: ${manifest.commands.length}`,
    `Services: ${manifest.services.length}`,
    `Verifications: ${manifest.verifications.length}`,
    `Blockers: ${manifest.blockers.length}`,
    `Target: ${targetPath}`
  ];
  if (manifest.blockers.length > 0) {
    lines.push("", "Blocking declarations:");
    for (const blocker of manifest.blockers) lines.push(`- ${blocker.subject}: ${blocker.summary}`);
  }
  return lines.join("\n");
}
