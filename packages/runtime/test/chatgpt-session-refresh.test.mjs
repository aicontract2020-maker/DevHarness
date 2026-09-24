import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  accessTokenNeedsRefresh,
  ensureFreshChatgptSessionCredential,
  parseJwtExpiration,
  persistCodexAuthTokens,
  refreshChatgptAccessToken,
  CHATGPT_OAUTH_CLIENT_ID,
  CHATGPT_REFRESH_TOKEN_URL
} from "../src/chatgpt-session-refresh.mjs";
import { createProviderProxyResponder } from "../src/provider-proxy.mjs";
import { prepareCodexExecutionContext, defaultCodexProfile } from "../src/codex-runtime.mjs";

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function fakeJwt({ exp, iat, client_id = CHATGPT_OAUTH_CLIENT_ID } = {}) {
  const header = b64url({ alg: "none", typ: "JWT" });
  const payload = b64url({
    aud: ["https://api.openai.com/v1"],
    iss: "https://auth.openai.com",
    client_id,
    ...(iat != null ? { iat } : {}),
    ...(exp != null ? { exp } : {})
  });
  return `${header}.${payload}.sig`;
}

test("parseJwtExpiration reads exp without treating opaque tokens as expired", () => {
  const exp = Math.floor(Date.parse("2026-09-24T12:00:00.000Z") / 1000);
  const token = fakeJwt({ exp, iat: exp - 3600 });
  assert.equal(parseJwtExpiration(token).toISOString(), "2026-09-24T12:00:00.000Z");
  assert.equal(parseJwtExpiration("not-a-jwt"), null);
  assert.equal(parseJwtExpiration("a.b"), null);
});

test("accessTokenNeedsRefresh matches Codex window and last_refresh fallback", () => {
  const now = () => new Date("2026-09-24T12:00:00.000Z");
  const soon = fakeJwt({ exp: Math.floor(Date.parse("2026-09-24T12:03:00.000Z") / 1000) });
  const later = fakeJwt({ exp: Math.floor(Date.parse("2026-09-24T13:00:00.000Z") / 1000) });
  assert.equal(accessTokenNeedsRefresh({ accessToken: soon, now }), true);
  assert.equal(accessTokenNeedsRefresh({ accessToken: later, now }), false);
  assert.equal(accessTokenNeedsRefresh({ accessToken: later, now, force: true }), true);
  assert.equal(accessTokenNeedsRefresh({
    accessToken: "opaque-token",
    lastRefresh: "2026-09-10T12:00:00.000Z",
    now
  }), true);
  assert.equal(accessTokenNeedsRefresh({
    accessToken: "opaque-token",
    lastRefresh: "2026-09-20T12:00:00.000Z",
    now
  }), false);
  assert.equal(accessTokenNeedsRefresh({ accessToken: "opaque-token", now }), false);
});

test("refreshChatgptAccessToken posts Codex-shaped JSON and never embeds secrets in thrown messages", async () => {
  const calls = [];
  const result = await refreshChatgptAccessToken({
    refreshToken: "secret-refresh-token-value",
    clientId: CHATGPT_OAUTH_CLIENT_ID,
    refreshUrl: CHATGPT_REFRESH_TOKEN_URL,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        id_token: "new-id-token",
        expires_in: 3600
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(calls[0].url, CHATGPT_REFRESH_TOKEN_URL);
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.grant_type, "refresh_token");
  assert.equal(body.client_id, CHATGPT_OAUTH_CLIENT_ID);
  assert.equal(body.refresh_token, "secret-refresh-token-value");
  assert.equal(result.accessToken, "new-access-token");
  assert.equal(result.refreshToken, "new-refresh-token");
  assert.equal(result.idToken, "new-id-token");

  await assert.rejects(
    () => refreshChatgptAccessToken({
      refreshToken: "secret-refresh-token-value",
      fetchImpl: async () => new Response(JSON.stringify({ error: "refresh_token_expired" }), { status: 401 })
    }),
    (error) => {
      assert.equal(error.code, "AUTH_UNAVAILABLE");
      assert.match(error.message, /refresh_token expired|Re-login/i);
      assert.equal(error.message.includes("secret-refresh-token-value"), false);
      assert.equal(String(error.stack ?? "").includes("secret-refresh-token-value"), false);
      return true;
    }
  );
});

test("persistCodexAuthTokens atomically updates tokens and preserves unrelated fields", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "devharness-persist-auth-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const authDir = path.join(home, ".codex");
  await mkdir(authDir, { recursive: true, mode: 0o700 });
  const authPath = path.join(authDir, "auth.json");
  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: "should-preserve",
    tokens: {
      access_token: "old-access",
      refresh_token: "old-refresh",
      account_id: "acct-preserve",
      id_token: "old-id"
    },
    last_refresh: "2026-09-01T00:00:00.000Z",
    extra_field: { keep: true }
  }, null, 2)}\n`, { mode: 0o600 });

  const persisted = await persistCodexAuthTokens({
    authPath,
    accessToken: "new-access",
    refreshToken: "new-refresh",
    idToken: "new-id",
    now: () => new Date("2026-09-24T12:00:00.000Z")
  });
  assert.deepEqual(persisted.updatedFields.sort(), [
    "last_refresh",
    "tokens.access_token",
    "tokens.id_token",
    "tokens.refresh_token"
  ]);
  const saved = JSON.parse(await readFile(authPath, "utf8"));
  assert.equal(saved.auth_mode, "chatgpt");
  assert.equal(saved.OPENAI_API_KEY, "should-preserve");
  assert.deepEqual(saved.extra_field, { keep: true });
  assert.equal(saved.tokens.account_id, "acct-preserve");
  assert.equal(saved.tokens.access_token, "new-access");
  assert.equal(saved.tokens.refresh_token, "new-refresh");
  assert.equal(saved.tokens.id_token, "new-id");
  assert.equal(saved.last_refresh, "2026-09-24T12:00:00.000Z");
  const mode = (await stat(authPath)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("ensureFreshChatgptSessionCredential refreshes near-expiry and skips fresh tokens", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "devharness-ensure-fresh-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const authPath = path.join(home, ".codex", "auth.json");
  await mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 });

  const nowMs = Date.parse("2026-09-24T12:00:00.000Z");
  const nearExp = fakeJwt({ exp: Math.floor((nowMs + 60_000) / 1000), iat: Math.floor(nowMs / 1000) - 1000 });
  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: nearExp,
      refresh_token: "secret-refresh-for-ensure",
      account_id: "acct-ensure"
    },
    last_refresh: "2026-09-18T00:00:00.000Z"
  }, null, 2)}\n`, { mode: 0o600 });

  const fetches = [];
  const refreshed = await ensureFreshChatgptSessionCredential({
    environment: { HOME: home },
    now: () => new Date(nowMs),
    fetchImpl: async (url, init) => {
      fetches.push({ url, body: init.body });
      assert.equal(String(init.body).includes("secret-refresh-for-ensure"), true);
      return new Response(JSON.stringify({
        access_token: "rotated-access-token",
        refresh_token: "rotated-refresh-token",
        id_token: "rotated-id-token"
      }), { status: 200 });
    }
  });
  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.value, "rotated-access-token");
  assert.equal(refreshed.accountId, "acct-ensure");
  assert.equal(fetches.length, 1);
  const saved = JSON.parse(await readFile(authPath, "utf8"));
  assert.equal(saved.tokens.access_token, "rotated-access-token");
  assert.equal(saved.tokens.refresh_token, "rotated-refresh-token");

  // Fresh token: skip refresh
  const freshExp = fakeJwt({ exp: Math.floor((nowMs + 3_600_000) / 1000) });
  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { access_token: freshExp, refresh_token: "unused-refresh", account_id: "acct-ensure" },
    last_refresh: new Date(nowMs).toISOString()
  }, null, 2)}\n`, { mode: 0o600 });
  const skipped = await ensureFreshChatgptSessionCredential({
    environment: { HOME: home },
    now: () => new Date(nowMs),
    fetchImpl: async () => {
      throw new Error("refresh must not run");
    }
  });
  assert.equal(skipped.refreshed, false);
  assert.equal(skipped.value, freshExp);

  // Force refresh even when fresh
  const forced = await ensureFreshChatgptSessionCredential({
    environment: { HOME: home, DEVHARNESS_CHATGPT_FORCE_REFRESH: "1" },
    now: () => new Date(nowMs),
    fetchImpl: async () => new Response(JSON.stringify({
      access_token: "forced-access",
      refresh_token: "forced-refresh"
    }), { status: 200 })
  });
  assert.equal(forced.refreshed, true);
  assert.equal(forced.value, "forced-access");

  // Refresh failure surfaces AUTH_UNAVAILABLE without leaking tokens
  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { access_token: nearExp, refresh_token: "leak-check-refresh-token", account_id: "acct-ensure" },
    last_refresh: "2026-09-01T00:00:00.000Z"
  }, null, 2)}\n`, { mode: 0o600 });
  await assert.rejects(
    () => ensureFreshChatgptSessionCredential({
      environment: { HOME: home },
      now: () => new Date(nowMs),
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: "refresh_token_invalidated" } }), { status: 401 })
    }),
    (error) => {
      assert.equal(error.code, "AUTH_UNAVAILABLE");
      assert.equal(error.message.includes("leak-check-refresh-token"), false);
      assert.match(error.message, /revoked|Re-login/i);
      return true;
    }
  );
});

test("ensureFresh leaves apikey auth.json untouched", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "devharness-ensure-apikey-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const authPath = path.join(home, ".codex", "auth.json");
  await mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 });
  const original = {
    auth_mode: "apikey",
    OPENAI_API_KEY: "sk-apikey-mode"
  };
  await writeFile(authPath, `${JSON.stringify(original, null, 2)}\n`, { mode: 0o600 });
  const result = await ensureFreshChatgptSessionCredential({
    environment: { HOME: home },
    credential: { key: "env", value: "sk-env", source: "env" },
    forceRefresh: true,
    fetchImpl: async () => { throw new Error("must not refresh apikey"); }
  });
  assert.equal(result.source, "env");
  assert.equal(result.value, "sk-env");
  assert.deepEqual(JSON.parse(await readFile(authPath, "utf8")), original);
});

test("provider proxy retries once after ChatGPT 401 when refreshParentCredential succeeds", async () => {
  const childToken = "child-token";
  let credential = "stale-access";
  const fetches = [];
  const sse = [
    "event: response.completed",
    'data: {"type":"response.completed","response":{"id":"resp-retry","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
    "",
    ""
  ].join("\n");
  const respond = createProviderProxyResponder({
    exactOrigins: ["https://chatgpt.com"],
    childToken,
    parentCredential: () => credential,
    chatgptAccountId: "acct-retry",
    chatgptMode: true,
    refreshParentCredential: async () => {
      credential = "fresh-access";
      return credential;
    },
    operationId: "operation-refresh",
    attemptId: "attempt-refresh",
    fetchImpl: async (_url, init) => {
      fetches.push(init.headers.authorization);
      if (init.headers.authorization === "Bearer stale-access") {
        return new Response("unauthorized", { status: 401, headers: { "content-type": "text/plain" } });
      }
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
    },
    now: () => new Date("2026-09-24T12:00:00.000Z")
  });
  const response = await respond({
    method: "POST",
    url: "/backend-api/codex/responses",
    headers: { authorization: `Bearer ${childToken}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.6-sol", input: "hello", stream: true })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(fetches, ["Bearer stale-access", "Bearer fresh-access"]);
});

test("prepareCodexExecutionContext force-refreshes chatgpt auth before proxy start", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-prep-refresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  await mkdir(path.join(home, ".codex"), { recursive: true, mode: 0o700 });
  const nowMs = Date.parse("2026-09-24T12:00:00.000Z");
  const nearExp = fakeJwt({ exp: Math.floor((nowMs + 30_000) / 1000) });
  await writeFile(path.join(home, ".codex", "auth.json"), `${JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: nearExp,
      refresh_token: "prep-refresh-secret",
      account_id: "acct-prep"
    },
    last_refresh: "2026-09-01T00:00:00.000Z"
  }, null, 2)}\n`, { mode: 0o600 });

  // Monkeypatch global fetch used by ensureFresh defaults — inject via env path by stubbing through prepare? 
  // prepareCodexExecutionContext does not accept fetchImpl; temporarily patch global fetch.
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push(String(url));
    assert.equal(String(url), CHATGPT_REFRESH_TOKEN_URL);
    assert.equal(String(init.body).includes("prep-refresh-secret"), true);
    return new Response(JSON.stringify({
      access_token: "prep-new-access",
      refresh_token: "prep-new-refresh"
    }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const calls = [];
  const prepared = await prepareCodexExecutionContext({
    analysisRoot: root,
    attemptRoot: path.join(root, "attempt"),
    privateHome: path.join(root, "private-home"),
    supervisorRoot: path.join(root, "supervisor"),
    resultPath: path.join(root, "attempt", "result.json"),
    operationId: "alignment-operation-refresh",
    attemptId: "attempt-refresh",
    environment: {
      HOME: home,
      PATH: "/usr/bin:/bin",
      DEVHARNESS_CODEX_DISABLE_WELL_KNOWN: "1",
      DEVHARNESS_CHATGPT_FORCE_REFRESH: "1"
    },
    profile: defaultCodexProfile({ HOME: home }),
    async startProxy(options) {
      calls.push(options);
      return { server: { close(cb) { cb?.(); } }, port: 43301, token: options.childToken, origin: "http://127.0.0.1:43301" };
    }
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(calls.length, 1);
  const parentCredential = typeof calls[0].parentCredential === "function" ? calls[0].parentCredential() : calls[0].parentCredential;
  assert.equal(parentCredential, "prep-new-access");
  assert.equal(typeof calls[0].refreshParentCredential, "function");
  assert.equal(prepared.profile.authMode, "chatgpt");
  const saved = JSON.parse(await readFile(path.join(home, ".codex", "auth.json"), "utf8"));
  assert.equal(saved.tokens.access_token, "prep-new-access");
});

test("env API key path remains unchanged and does not refresh auth.json", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-env-wins-refresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  await mkdir(path.join(home, ".codex"), { recursive: true, mode: 0o700 });
  const authPath = path.join(home, ".codex", "auth.json");
  const nearExp = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 30 });
  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { access_token: nearExp, refresh_token: "should-not-use", account_id: "acct-env" }
  }, null, 2)}\n`, { mode: 0o600 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("refresh must not run for env credential"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  await prepareCodexExecutionContext({
    analysisRoot: root,
    attemptRoot: path.join(root, "attempt"),
    privateHome: path.join(root, "private-home"),
    supervisorRoot: path.join(root, "supervisor"),
    resultPath: path.join(root, "attempt", "result.json"),
    operationId: "alignment-operation-env",
    attemptId: "attempt-env",
    environment: {
      HOME: home,
      OPENAI_API_KEY: "sk-env-wins-over-authjson",
      DEVHARNESS_CHATGPT_FORCE_REFRESH: "1"
    },
    profile: defaultCodexProfile({}),
    async startProxy(options) {
      calls.push(options);
      return { server: { close(cb) { cb?.(); } }, port: 43302, token: options.childToken, origin: "http://127.0.0.1:43302" };
    }
  });
  const parentCredential = typeof calls[0].parentCredential === "function" ? calls[0].parentCredential() : calls[0].parentCredential;
  assert.equal(parentCredential, "sk-env-wins-over-authjson");
  assert.equal(calls[0].refreshParentCredential, null);
  assert.equal(calls[0].chatgptMode, false);
  const saved = JSON.parse(await readFile(authPath, "utf8"));
  assert.equal(saved.tokens.refresh_token, "should-not-use");
});
