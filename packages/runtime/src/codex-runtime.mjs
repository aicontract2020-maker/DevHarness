import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashContract } from "../../project/src/harness.mjs";
import { ensureFreshChatgptSessionCredential } from "./chatgpt-session-refresh.mjs";
import { startProviderProxyServer } from "./provider-proxy.mjs";

export const CODEX_ADAPTER_ID = "codex";
export const CODEX_READONLY_PROFILE_ID = "codex-readonly-analysis-v1";
export const LOCAL_READONLY_ADAPTER_ID = "devharness-cli-local-agent";
export const DEFAULT_CODEX_MODEL_ID = "gpt-5.6-sol";
export const DEFAULT_CODEX_ORIGIN = "https://api.openai.com";
export const DEFAULT_CHATGPT_CODEX_ORIGIN = "https://chatgpt.com";
export const APIKEY_CODEX_API_PATH_PREFIX = "/v1";
export const CHATGPT_CODEX_API_PATH_PREFIX = "/backend-api/codex";
export const WELL_KNOWN_CODEX_PATHS = Object.freeze([
  "/Applications/ChatGPT.app/Contents/Resources/codex"
]);

export const CODEX_OUTPUT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "phase", "summary", "adapter", "profile_id", "notes"],
  properties: {
    schema_version: { type: "integer", const: 1 },
    phase: { type: "string", enum: ["analysis-plan", "analysis-synthesis", "analysis-validation"] },
    summary: { type: "string" },
    adapter: { type: "string" },
    profile_id: { type: "string" },
    notes: { type: "array", items: { type: "string" } }
  }
});

const CREDENTIAL_ENV_KEYS = Object.freeze(["DEVHARNESS_PROVIDER_CREDENTIAL", "OPENAI_API_KEY"]);
const COMPATIBLE_CODEX_AUTH_MODES = Object.freeze(new Set(["apikey", "chatgpt"]));

export function isChatgptCodexOrigin(origin) {
  try {
    return new URL(String(origin ?? "")).hostname === "chatgpt.com";
  } catch {
    return false;
  }
}

export function resolveCodexApiPathPrefix({ authMode = null, origin = null } = {}) {
  const mode = String(authMode ?? "").trim().toLowerCase();
  if (mode === "chatgpt" || isChatgptCodexOrigin(origin)) return CHATGPT_CODEX_API_PATH_PREFIX;
  return APIKEY_CODEX_API_PATH_PREFIX;
}

export function defaultCodexProfile(environment = process.env, { authMode = null } = {}) {
  const explicitOrigin = String(environment.DEVHARNESS_CODEX_ORIGIN ?? "").trim();
  const forcedMode = String(environment.DEVHARNESS_CODEX_AUTH_MODE ?? "").trim().toLowerCase();
  const resolvedMode = String(
    authMode
      ?? (forcedMode || null)
      ?? resolveProviderCredential(environment)?.authMode
      ?? ""
  ).trim().toLowerCase() || null;
  const origin = explicitOrigin
    || (resolvedMode === "chatgpt" ? DEFAULT_CHATGPT_CODEX_ORIGIN : DEFAULT_CODEX_ORIGIN);
  const modelId = String(environment.DEVHARNESS_CODEX_MODEL ?? "").trim() || DEFAULT_CODEX_MODEL_ID;
  return {
    id: CODEX_READONLY_PROFILE_ID,
    modelId,
    controlPlaneOrigins: [origin],
    authMode: resolvedMode,
    apiPathPrefix: resolveCodexApiPathPrefix({ authMode: resolvedMode, origin }),
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
  if (authMode === "chatgpt") {
    const tokens = parsed.tokens;
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return null;
    const value = tokens.access_token;
    if (typeof value !== "string" || value.trim().length === 0) return null;
    const accountIdRaw = tokens.account_id;
    const accountId = typeof accountIdRaw === "string" && accountIdRaw.trim().length > 0
      ? accountIdRaw.trim()
      : undefined;
    const hasRefreshToken = typeof tokens.refresh_token === "string" && tokens.refresh_token.trim().length > 0;
    const lastRefresh = typeof parsed.last_refresh === "string" && parsed.last_refresh.trim().length > 0
      ? parsed.last_refresh.trim()
      : null;
    return {
      key: "codex-auth.json:tokens.access_token",
      value: value.trim(),
      source: "codex-auth.json",
      authMode: "chatgpt",
      hasRefreshToken,
      ...(lastRefresh ? { lastRefresh } : {}),
      ...(accountId ? { accountId } : {})
    };
  }
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
  if (!credential) missing.push("parent provider credential (export OPENAI_API_KEY or DEVHARNESS_PROVIDER_CREDENTIAL, or use ~/.codex/auth.json with auth_mode=apikey or auth_mode=chatgpt session tokens)");
  return [
    "Codex adapter is not ready for a live provider call.",
    missing.length ? `Missing: ${missing.join("; ")}.` : "Provider proxy could not start.",
    "Parent may load credentials from ~/.codex/auth.json when env is unset: auth_mode=apikey (OPENAI_API_KEY) or auth_mode=chatgpt (tokens.access_token + optional tokens.account_id / tokens.refresh_token).",
    "ChatGPT session tokens are used only by the parent-owned loopback proxy (origin https://chatgpt.com, path prefix /backend-api/codex); parent refreshes access_token via auth.openai.com oauth when needed.",
    "DevHarness does not mount login/session files into the Agent (`--ignore-user-config`).",
    "Example:",
    "  export DEVHARNESS_CODEX_PATH=\"/Applications/ChatGPT.app/Contents/Resources/codex\"",
    "  export OPENAI_API_KEY  # or DEVHARNESS_PROVIDER_CREDENTIAL; else parent reads ~/.codex/auth.json",
    "  # optional: export DEVHARNESS_CODEX_MODEL=\"gpt-5.6-sol\"",
    "  # optional: export DEVHARNESS_CODEX_ORIGIN=\"https://api.openai.com\"  # or https://chatgpt.com for chatgpt auth",
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
  const resolvedCredential = (() => {
    if (providerCredential && typeof providerCredential === "object" && typeof providerCredential.value === "string") {
      return providerCredential;
    }
    if (typeof providerCredential === "string" && providerCredential.trim().length > 0) {
      const fromEnv = resolveProviderCredential(environment);
      return {
        value: providerCredential.trim(),
        source: fromEnv?.source ?? "injected",
        key: fromEnv?.key ?? "injected",
        authMode: fromEnv?.authMode,
        accountId: fromEnv?.accountId
      };
    }
    return resolveProviderCredential(environment);
  })();
  let activeCredential = resolvedCredential;
  const initialAuthMode = String(
    activeCredential?.authMode
      ?? profile?.authMode
      ?? environment.DEVHARNESS_CODEX_AUTH_MODE
      ?? ""
  ).trim().toLowerCase() || null;
  // Env API keys keep winning; only chatgpt auth.json sessions are refreshed.
  if (
    activeCredential
    && activeCredential.source === "codex-auth.json"
    && (activeCredential.authMode === "chatgpt" || initialAuthMode === "chatgpt")
  ) {
    activeCredential = await ensureFreshChatgptSessionCredential({
      environment,
      credential: activeCredential,
      forceRefresh: String(environment.DEVHARNESS_CHATGPT_FORCE_REFRESH ?? "").trim() === "1"
    });
  }
  const credential = activeCredential?.value ?? null;
  const authMode = String(
    activeCredential?.authMode
      ?? profile?.authMode
      ?? environment.DEVHARNESS_CODEX_AUTH_MODE
      ?? ""
  ).trim().toLowerCase() || null;
  const accountId = typeof activeCredential?.accountId === "string" && activeCredential.accountId.trim().length > 0
    ? activeCredential.accountId.trim()
    : null;
  const resolvedProfile = profile ?? defaultCodexProfile(environment, { authMode });
  const executable = await resolveCodexExecutable(environment);
  if (!credential) {
    const error = new Error(codexAuthUnavailableMessage({ executable, credential: null }));
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }
  const targetOrigin = resolvedProfile.controlPlaneOrigins[0];
  const apiPathPrefix = resolvedProfile.apiPathPrefix
    ?? resolveCodexApiPathPrefix({ authMode, origin: targetOrigin });
  const chatgptMode = authMode === "chatgpt" || isChatgptCodexOrigin(targetOrigin);
  const outputSchemaPath = await writeCodexOutputSchema(attemptRoot);
  const childToken = ephemeralProxyToken();
  const credentialHolder = { value: credential };
  const refreshParentCredential = chatgptMode && activeCredential?.source === "codex-auth.json"
    ? async () => {
        const refreshed = await ensureFreshChatgptSessionCredential({
          environment,
          credential: activeCredential,
          forceRefresh: true
        });
        activeCredential = refreshed;
        credentialHolder.value = refreshed.value;
        return refreshed.value;
      }
    : null;
  const proxy = await startProxy({
    exactOrigins: resolvedProfile.controlPlaneOrigins,
    targetOrigin,
    childToken,
    parentCredential: () => credentialHolder.value,
    chatgptAccountId: accountId,
    chatgptMode,
    refreshParentCredential,
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
        apiPathPrefix,
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

export {
  accessTokenNeedsRefresh,
  ensureFreshChatgptSessionCredential,
  persistCodexAuthTokens,
  refreshChatgptAccessToken,
  CHATGPT_OAUTH_CLIENT_ID,
  CHATGPT_REFRESH_TOKEN_URL
} from "./chatgpt-session-refresh.mjs";
