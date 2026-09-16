import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashContract } from "../../project/src/harness.mjs";
import { startProviderProxyServer } from "./provider-proxy.mjs";

export const CODEX_ADAPTER_ID = "codex";
export const CODEX_READONLY_PROFILE_ID = "codex-readonly-analysis-v1";
export const LOCAL_READONLY_ADAPTER_ID = "devharness-cli-local-agent";
export const DEFAULT_CODEX_MODEL_ID = "gpt-5.6-sol";
export const DEFAULT_CODEX_ORIGIN = "https://api.openai.com";
export const WELL_KNOWN_CODEX_PATHS = Object.freeze([
  "/Applications/ChatGPT.app/Contents/Resources/codex"
]);

export const CODEX_OUTPUT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: true,
  required: ["schema_version", "phase"],
  properties: {
    schema_version: { const: 1 },
    phase: { enum: ["analysis-plan", "analysis-synthesis", "analysis-validation"] },
    summary: { type: "string" },
    adapter: { type: "string" },
    profile_id: { type: "string" },
    goal_analysis: { type: "object" },
    validation: { type: "object" }
  }
});

const CREDENTIAL_ENV_KEYS = Object.freeze(["DEVHARNESS_PROVIDER_CREDENTIAL", "OPENAI_API_KEY"]);
const COMPATIBLE_CODEX_AUTH_MODES = Object.freeze(new Set(["apikey"]));

export function defaultCodexProfile(environment = process.env) {
  const origin = String(environment.DEVHARNESS_CODEX_ORIGIN ?? "").trim() || DEFAULT_CODEX_ORIGIN;
  const modelId = String(environment.DEVHARNESS_CODEX_MODEL ?? "").trim() || DEFAULT_CODEX_MODEL_ID;
  return {
    id: CODEX_READONLY_PROFILE_ID,
    modelId,
    controlPlaneOrigins: [origin],
    template: {
      sandbox: "read-only",
      maxActiveSeconds: 600,
      change: false,
      execute: false,
      modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"]
    }
  };
}

export function resolveCodexAuthFilePath(environment = process.env) {
  const home = String(environment.HOME ?? "").trim();
  if (!home) return null;
  return path.join(home, ".codex", "auth.json");
}

/**
 * Parent-only credential fallback from ~/.codex/auth.json.
 * Never mount this file into the Agent; the loopback proxy alone uses the value.
 */
export function loadProviderCredentialFromCodexAuthFile(environment = process.env) {
  const authPath = resolveCodexAuthFilePath(environment);
  if (!authPath) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(authPath, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const authMode = String(parsed.auth_mode ?? "").trim().toLowerCase();
  if (!COMPATIBLE_CODEX_AUTH_MODES.has(authMode)) return null;
  const value = parsed.OPENAI_API_KEY;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return {
    key: "codex-auth.json:OPENAI_API_KEY",
    value: value.trim(),
    source: "codex-auth.json",
    authMode
  };
}

export function resolveProviderCredential(environment = process.env) {
  for (const key of CREDENTIAL_ENV_KEYS) {
    const value = environment[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return { key, value: value.trim(), source: "env" };
    }
  }
  return loadProviderCredentialFromCodexAuthFile(environment);
}

export async function resolveCodexExecutable(environment = process.env) {
  const explicit = String(environment.DEVHARNESS_CODEX_PATH ?? "").trim();
  const searchPath = String(environment.PATH ?? "");
  const candidates = [];
  if (explicit) candidates.push(explicit);
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, "codex"));
  }
  if (environment.DEVHARNESS_CODEX_DISABLE_WELL_KNOWN !== "1") {
    candidates.push(...WELL_KNOWN_CODEX_PATHS);
  }
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

export async function isCodexConfigured(environment = process.env) {
  const executable = await resolveCodexExecutable(environment);
  const credential = resolveProviderCredential(environment);
  return Boolean(executable && credential);
}

export function codexAuthUnavailableMessage({ executable = null, credential = null } = {}) {
  const missing = [];
  if (!executable) missing.push("Codex CLI executable (install @openai/codex, put `codex` on PATH, or export DEVHARNESS_CODEX_PATH)");
  if (!credential) missing.push("parent provider credential (export OPENAI_API_KEY or DEVHARNESS_PROVIDER_CREDENTIAL, or use ~/.codex/auth.json with auth_mode=apikey)");
  return [
    "Codex adapter is not ready for a live provider call.",
    missing.length ? `Missing: ${missing.join("; ")}.` : "Provider proxy could not start.",
    "Parent may load OPENAI_API_KEY from ~/.codex/auth.json when env is unset and auth_mode is apikey; that value is used only by the parent-owned loopback proxy.",
    "DevHarness does not mount login/session files into the Agent (`--ignore-user-config`).",
    "`codex login` alone is not enough for ChatGPT session cookies: continue still needs an API key via env or auth.json.",
    "Example:",
    "  export DEVHARNESS_CODEX_PATH=\"/Applications/ChatGPT.app/Contents/Resources/codex\"",
    "  export OPENAI_API_KEY  # or DEVHARNESS_PROVIDER_CREDENTIAL; else parent reads ~/.codex/auth.json",
    "  # optional: export DEVHARNESS_CODEX_MODEL=\"gpt-5\"",
    "  # optional: export DEVHARNESS_CODEX_ORIGIN=\"https://api.openai.com\"",
    "  $DH align --continue --agent codex --repo \"$REPO\" --config \"$CONFIG\" --run \"$RUN_ID\"",
    "Fallback without keys:",
    "  $DH align --continue --agent devharness-cli-local-agent --repo \"$REPO\" --config \"$CONFIG\" --run \"$RUN_ID\""
  ].join("\n");
}

export async function resolveAlignAgentSelection({
  requestedAgentId = null,
  requestedProfileId = null,
  environment = process.env
} = {}) {
  const executable = await resolveCodexExecutable(environment);
  const credential = resolveProviderCredential(environment);
  const codexReady = Boolean(executable && credential);
  const profileId = requestedProfileId ?? CODEX_READONLY_PROFILE_ID;
  if (requestedAgentId && requestedAgentId !== CODEX_ADAPTER_ID && requestedAgentId !== LOCAL_READONLY_ADAPTER_ID) {
    return {
      agentId: requestedAgentId,
      agentProfileId: profileId,
      source: "flag",
      codexReady,
      executable,
      credentialKey: credential?.key ?? null
    };
  }
  if (requestedAgentId === CODEX_ADAPTER_ID) {
    return {
      agentId: CODEX_ADAPTER_ID,
      agentProfileId: profileId,
      source: "flag",
      codexReady,
      executable,
      credentialKey: credential?.key ?? null,
      missing: [
        executable ? null : "executable",
        credential ? null : "credential"
      ].filter(Boolean)
    };
  }
  if (requestedAgentId === LOCAL_READONLY_ADAPTER_ID) {
    return {
      agentId: LOCAL_READONLY_ADAPTER_ID,
      agentProfileId: profileId,
      source: "flag",
      codexReady,
      executable,
      credentialKey: credential?.key ?? null
    };
  }
  if (codexReady) {
    return {
      agentId: CODEX_ADAPTER_ID,
      agentProfileId: profileId,
      source: "configured",
      codexReady: true,
      executable,
      credentialKey: credential.key
    };
  }
  return {
    agentId: LOCAL_READONLY_ADAPTER_ID,
    agentProfileId: profileId,
    source: "local-readonly-fallback",
    codexReady: false,
    executable,
    credentialKey: credential?.key ?? null
  };
}

export function ephemeralProxyToken() {
  return randomBytes(32).toString("hex");
}

export async function writeCodexOutputSchema(attemptRoot) {
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });
  const outputSchemaPath = path.join(attemptRoot, "output-schema.json");
  await writeFile(outputSchemaPath, `${JSON.stringify(CODEX_OUTPUT_SCHEMA, null, 2)}\n`, "utf8");
  return outputSchemaPath;
}

export async function prepareCodexExecutionContext({
  analysisRoot,
  attemptRoot,
  privateHome,
  supervisorRoot,
  resultPath,
  operationId,
  attemptId,
  environment = process.env,
  profile = null,
  providerCredential = null,
  startProxy = startProviderProxyServer
} = {}) {
  const resolvedProfile = profile ?? defaultCodexProfile(environment);
  const credential = providerCredential
    ?? resolveProviderCredential(environment)?.value
    ?? null;
  const executable = await resolveCodexExecutable(environment);
  if (!credential) {
    const error = new Error(codexAuthUnavailableMessage({ executable, credential: null }));
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }
  const outputSchemaPath = await writeCodexOutputSchema(attemptRoot);
  const childToken = ephemeralProxyToken();
  const proxy = await startProxy({
    exactOrigins: resolvedProfile.controlPlaneOrigins,
    targetOrigin: resolvedProfile.controlPlaneOrigins[0],
    childToken,
    parentCredential: credential,
    operationId,
    attemptId,
    targetDescriptorSha256: hashContract({ adapterName: CODEX_ADAPTER_ID, kind: "target-descriptor" }),
    proxyPolicySha256: hashContract({ adapterName: CODEX_ADAPTER_ID, kind: "proxy-policy" })
  });
  return {
    context: {
      analysisRoot,
      attemptTmpPath: path.join(attemptRoot, "tmp"),
      privateHome,
      supervisorRoot,
      resultPath,
      outputSchemaPath,
      proxy: {
        port: proxy.port,
        token: childToken,
        endpoint: proxy.origin,
        tokenId: `proxy-${proxy.port}`,
        targetDescriptorSha256: hashContract({ adapterName: CODEX_ADAPTER_ID, kind: "target-descriptor" }),
        policySha256: hashContract({ adapterName: CODEX_ADAPTER_ID, kind: "proxy-policy" })
      }
    },
    proxyServer: proxy.server ?? null,
    profile: resolvedProfile
  };
}

export async function closeProviderProxy(proxyServer) {
  if (!proxyServer || typeof proxyServer.close !== "function") return;
  try {
    await new Promise((resolve) => {
      const result = proxyServer.close(() => resolve());
      if (result && typeof result.then === "function") {
        result.then(() => resolve(), () => resolve());
      }
    });
  } catch {}
}
