import { chmod, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Matches Codex CLI oauth client id used for ChatGPT session refresh. */
export const CHATGPT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
/** Matches Codex CLI REFRESH_TOKEN_URL. */
export const CHATGPT_REFRESH_TOKEN_URL = "https://auth.openai.com/oauth/token";
/** Matches Codex CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES. */
export const CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
/** Matches Codex TOKEN_REFRESH_INTERVAL (days) when JWT exp is unavailable. */
export const CHATGPT_LAST_REFRESH_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function decodeJwtPayload(token) {
  if (!isNonEmptyString(token)) return null;
  const parts = String(token).split(".");
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Parse access-token JWT `exp` (seconds) without verifying the signature.
 * Returns Date or null when the token is not a JWT / has no exp.
 */
export function parseJwtExpiration(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload || !Number.isFinite(payload.exp)) return null;
  return new Date(Number(payload.exp) * 1000);
}

export function resolveChatgptOAuthClientId({ accessToken = null, environment = process.env } = {}) {
  const fromEnv = String(environment.DEVHARNESS_CHATGPT_OAUTH_CLIENT_ID ?? "").trim();
  if (fromEnv) return fromEnv;
  const payload = decodeJwtPayload(accessToken);
  if (isNonEmptyString(payload?.client_id)) return payload.client_id.trim();
  return CHATGPT_OAUTH_CLIENT_ID;
}

export function resolveChatgptRefreshTokenUrl(environment = process.env) {
  const fromDevHarness = String(environment.DEVHARNESS_CHATGPT_REFRESH_TOKEN_URL ?? "").trim();
  if (fromDevHarness) return fromDevHarness;
  const fromCodex = String(environment.CODEX_REFRESH_TOKEN_URL_OVERRIDE ?? "").trim();
  if (fromCodex) return fromCodex;
  return CHATGPT_REFRESH_TOKEN_URL;
}

/**
 * Decide whether the ChatGPT access token should be refreshed proactively.
 * Mirrors Codex: JWT exp within 5 minutes, else last_refresh older than 8 days.
 */
export function accessTokenNeedsRefresh({
  accessToken,
  lastRefresh = null,
  now = () => new Date(),
  force = false,
  refreshWindowMs = CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  lastRefreshMaxAgeMs = CHATGPT_LAST_REFRESH_MAX_AGE_MS
} = {}) {
  if (force) return true;
  const current = typeof now === "function" ? now() : now;
  const currentMs = current instanceof Date ? current.getTime() : Number(current);
  if (!Number.isFinite(currentMs)) return false;

  const expiresAt = parseJwtExpiration(accessToken);
  if (expiresAt instanceof Date && Number.isFinite(expiresAt.getTime())) {
    return expiresAt.getTime() <= currentMs + refreshWindowMs;
  }

  if (isNonEmptyString(lastRefresh) || lastRefresh instanceof Date) {
    const lastMs = lastRefresh instanceof Date ? lastRefresh.getTime() : Date.parse(String(lastRefresh));
    if (Number.isFinite(lastMs)) {
      return lastMs < currentMs - lastRefreshMaxAgeMs;
    }
  }
  return false;
}

function extractRefreshErrorCode(bodyText) {
  if (!isNonEmptyString(bodyText)) return null;
  try {
    const parsed = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.code === "string") {
      return parsed.error.code;
    }
    if (typeof parsed.code === "string") return parsed.code;
  } catch {}
  return null;
}

function refreshFailureMessage(code) {
  const normalized = String(code ?? "").trim().toLowerCase();
  if (normalized === "refresh_token_expired") {
    return "ChatGPT session refresh failed: refresh_token expired. Re-login with Codex/ChatGPT (`codex login`), then retry Align.";
  }
  if (normalized === "refresh_token_reused") {
    return "ChatGPT session refresh failed: refresh_token already used. Re-login with Codex/ChatGPT, then retry Align.";
  }
  if (normalized === "refresh_token_invalidated") {
    return "ChatGPT session refresh failed: refresh_token revoked. Re-login with Codex/ChatGPT, then retry Align.";
  }
  return "ChatGPT session refresh failed. Re-login with Codex/ChatGPT (`codex login`), then retry Align.";
}

/**
 * Call OpenAI oauth token endpoint with grant_type=refresh_token (Codex CLI shape).
 * Never logs token values.
 */
export async function refreshChatgptAccessToken({
  refreshToken,
  clientId = CHATGPT_OAUTH_CLIENT_ID,
  refreshUrl = CHATGPT_REFRESH_TOKEN_URL,
  fetchImpl = fetch
} = {}) {
  if (!isNonEmptyString(refreshToken)) {
    const error = new Error("ChatGPT session refresh requires tokens.refresh_token in ~/.codex/auth.json.");
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }
  if (!isNonEmptyString(clientId)) {
    const error = new Error("ChatGPT session refresh requires an OAuth client_id.");
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }
  if (!isNonEmptyString(refreshUrl) || !String(refreshUrl).startsWith("https://")) {
    const error = new Error("ChatGPT session refresh URL must be an https endpoint.");
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }

  let response;
  try {
    response = await fetchImpl(refreshUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        client_id: clientId.trim(),
        grant_type: "refresh_token",
        refresh_token: refreshToken.trim()
      })
    });
  } catch (cause) {
    const error = new Error(`ChatGPT session refresh network failure: ${String(cause?.message ?? cause).slice(0, 200)}`);
    error.code = "AUTH_UNAVAILABLE";
    error.cause = cause;
    throw error;
  }

  const bodyText = await response.text();
  if (!response.ok) {
    const code = extractRefreshErrorCode(bodyText);
    const error = new Error(refreshFailureMessage(code));
    error.code = "AUTH_UNAVAILABLE";
    error.status = response.status;
    error.refreshErrorCode = code;
    throw error;
  }

  let payload;
  try {
    payload = bodyText.length > 0 ? JSON.parse(bodyText) : null;
  } catch {
    const error = new Error("ChatGPT session refresh returned invalid JSON.");
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("ChatGPT session refresh returned a malformed payload.");
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }
  const accessToken = payload.access_token;
  if (!isNonEmptyString(accessToken)) {
    const error = new Error("ChatGPT session refresh response missing access_token.");
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }
  return {
    accessToken: accessToken.trim(),
    refreshToken: isNonEmptyString(payload.refresh_token) ? payload.refresh_token.trim() : refreshToken.trim(),
    idToken: isNonEmptyString(payload.id_token) ? payload.id_token.trim() : null,
    expiresIn: Number.isFinite(payload.expires_in) ? Number(payload.expires_in) : null
  };
}

/**
 * Atomically update tokens.* and last_refresh in auth.json, preserving other fields.
 * Uses a temp file + rename and enforces 0600 permissions (Codex file-store style).
 */
export async function persistCodexAuthTokens({
  authPath,
  accessToken,
  refreshToken = null,
  idToken = null,
  lastRefresh = null,
  readFileSyncImpl = readFileSync,
  writeFileImpl = writeFile,
  renameImpl = rename,
  chmodImpl = chmod,
  now = () => new Date()
} = {}) {
  if (!isNonEmptyString(authPath)) throw new Error("persistCodexAuthTokens requires authPath.");
  if (!isNonEmptyString(accessToken)) throw new Error("persistCodexAuthTokens requires accessToken.");

  let parsed;
  try {
    parsed = JSON.parse(readFileSyncImpl(authPath, "utf8"));
  } catch (cause) {
    const error = new Error("Unable to read ~/.codex/auth.json for token persistence.");
    error.code = "AUTH_UNAVAILABLE";
    error.cause = cause;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("~/.codex/auth.json is malformed.");
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }

  const tokens = parsed.tokens && typeof parsed.tokens === "object" && !Array.isArray(parsed.tokens)
    ? { ...parsed.tokens }
    : {};
  tokens.access_token = accessToken.trim();
  if (isNonEmptyString(refreshToken)) tokens.refresh_token = refreshToken.trim();
  if (isNonEmptyString(idToken)) tokens.id_token = idToken.trim();

  const refreshedAt = lastRefresh instanceof Date
    ? lastRefresh.toISOString()
    : (isNonEmptyString(lastRefresh) ? String(lastRefresh) : (typeof now === "function" ? now() : now).toISOString());

  const next = {
    ...parsed,
    tokens,
    last_refresh: refreshedAt
  };

  const dir = path.dirname(authPath);
  const tmpPath = path.join(dir, `.auth.json.${process.pid}.${Date.now()}.tmp`);
  const encoded = `${JSON.stringify(next, null, 2)}\n`;
  await writeFileImpl(tmpPath, encoded, { mode: 0o600, encoding: "utf8" });
  await renameImpl(tmpPath, authPath);
  try {
    await chmodImpl(authPath, 0o600);
  } catch {
    // Permissions best-effort; content was already replaced atomically.
  }
  return {
    authPath,
    lastRefresh: refreshedAt,
    // Field names only — callers must not log values.
    updatedFields: ["tokens.access_token", ...(isNonEmptyString(refreshToken) ? ["tokens.refresh_token"] : []), ...(isNonEmptyString(idToken) ? ["tokens.id_token"] : []), "last_refresh"]
  };
}

/**
 * Ensure ChatGPT session access_token is fresh for parent proxy use.
 * Env API-key credentials are untouched (caller should skip when source=env).
 */
export async function ensureFreshChatgptSessionCredential({
  environment = process.env,
  authPath = null,
  credential = null,
  fetchImpl = fetch,
  now = () => new Date(),
  forceRefresh = false,
  persist = true,
  readFileSyncImpl = readFileSync
} = {}) {
  const resolvedPath = authPath
    ?? (isNonEmptyString(environment.HOME) ? path.join(environment.HOME, ".codex", "auth.json") : null);
  if (!resolvedPath) return credential;

  let parsed;
  try {
    parsed = JSON.parse(readFileSyncImpl(resolvedPath, "utf8"));
  } catch {
    return credential;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return credential;
  const authMode = String(parsed.auth_mode ?? "").trim().toLowerCase();
  if (authMode !== "chatgpt") return credential;

  const tokens = parsed.tokens;
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return credential;
  const accessToken = isNonEmptyString(tokens.access_token) ? tokens.access_token.trim() : null;
  const refreshToken = isNonEmptyString(tokens.refresh_token) ? tokens.refresh_token.trim() : null;
  const accountId = isNonEmptyString(tokens.account_id) ? tokens.account_id.trim() : undefined;
  const lastRefresh = parsed.last_refresh ?? null;
  if (!accessToken) return credential;

  const needs = accessTokenNeedsRefresh({
    accessToken,
    lastRefresh,
    now,
    force: forceRefresh === true || String(environment.DEVHARNESS_CHATGPT_FORCE_REFRESH ?? "").trim() === "1"
  });

  const baseCredential = credential && typeof credential === "object"
    ? { ...credential }
    : {
        key: "codex-auth.json:tokens.access_token",
        value: accessToken,
        source: "codex-auth.json",
        authMode: "chatgpt",
        ...(accountId ? { accountId } : {})
      };

  if (!needs) {
    return {
      ...baseCredential,
      value: accessToken,
      authMode: "chatgpt",
      source: "codex-auth.json",
      key: "codex-auth.json:tokens.access_token",
      ...(accountId ? { accountId } : {}),
      refreshed: false
    };
  }

  if (!refreshToken) {
    const error = new Error(
      "ChatGPT access_token needs refresh but tokens.refresh_token is missing in ~/.codex/auth.json. Re-login with Codex/ChatGPT, then retry Align."
    );
    error.code = "AUTH_UNAVAILABLE";
    throw error;
  }

  const clientId = resolveChatgptOAuthClientId({ accessToken, environment });
  const refreshUrl = resolveChatgptRefreshTokenUrl(environment);
  const refreshed = await refreshChatgptAccessToken({
    refreshToken,
    clientId,
    refreshUrl,
    fetchImpl
  });

  if (persist) {
    await persistCodexAuthTokens({
      authPath: resolvedPath,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      idToken: refreshed.idToken,
      now
    });
  }

  return {
    ...baseCredential,
    value: refreshed.accessToken,
    authMode: "chatgpt",
    source: "codex-auth.json",
    key: "codex-auth.json:tokens.access_token",
    ...(accountId ? { accountId } : {}),
    refreshed: true,
    refreshUrlHost: (() => {
      try { return new URL(refreshUrl).host; } catch { return null; }
    })()
  };
}
