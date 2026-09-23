import assert from "node:assert/strict";
import test from "node:test";

import { createProviderProxyResponder } from "../src/provider-proxy.mjs";

const now = "2026-09-01T12:00:00.000Z";
const childToken = "ephemeral-child-token";
const parentCredential = "parent-provider-secret";
const exactOrigins = ["https://api.example.com"];

function request(overrides = {}) {
  return {
    method: "POST",
    url: "/v1/responses",
    headers: { authorization: `Bearer ${childToken}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-approved", input: "hello", max_output_tokens: 32 }),
    ...overrides
  };
}

test("provider proxy requires the child token, injects the parent credential, and publishes a reservation before forwarding", async () => {
  const calls = [];
  const respond = createProviderProxyResponder({
    exactOrigins,
    childToken,
    parentCredential,
    operationId: "operation-1",
    attemptId: "attempt-1",
    fetchImpl: async (url, init) => {
      calls.push({ kind: "fetch", url, init });
      assert.equal(init.headers.authorization, `Bearer ${parentCredential}`);
      assert.equal(Object.hasOwn(init.headers, "x-devharness-proxy-token"), false);
      return new Response(JSON.stringify({ id: "resp-1", usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    publishReservation: async (reservation) => {
      calls.push({ kind: "reservation", reservation });
    },
    publishReceipt: async (receipt) => {
      calls.push({ kind: "receipt", receipt });
    },
    now: () => new Date(now)
  });

  const response = await respond(request());
  assert.equal(response.status, 200);
  assert.equal(calls[0].kind, "reservation");
  assert.equal(calls[1].kind, "fetch");
  assert.equal(calls.at(-1).kind, "receipt");
  assert.equal(calls[0].reservation.channel, "provider");
  assert.equal(calls[0].reservation.attempt_id, "attempt-1");
  assert.equal(calls[0].reservation.reserved_tokens, calls[0].reservation.reserved_input_tokens + calls[0].reservation.reserved_output_tokens);
  assert.equal(calls[0].reservation.reserved_active_ms, 0);
  assert.equal(calls[0].reservation.reserved_input_tokens > 0, true);
  assert.equal(calls[0].reservation.reserved_output_tokens, 32);
  assert.equal(calls[1].url, "https://api.example.com/v1/responses");
  assert.equal(calls[1].init.headers["content-type"], "application/json");
  assert.equal(calls[1].init.body.includes(parentCredential), false);
  assert.equal(calls[1].init.body.includes(childToken), false);
  assert.equal(calls.at(-1).receipt.status, "completed");
  assert.equal(calls.at(-1).receipt.usage.total_tokens, 18);
  assert.equal(JSON.parse(response.body).usage.total_tokens, 18);
});

test("provider proxy rejects wrong child credentials, cross-origin redirects, and missing usage", async () => {
  const respond = createProviderProxyResponder({
    exactOrigins,
    childToken,
    parentCredential,
    operationId: "operation-1",
    attemptId: "attempt-1",
    fetchImpl: async () => new Response(null, { status: 200 }),
    now: () => new Date(now)
  });

  assert.equal((await respond(request({ headers: { authorization: "Bearer wrong-token", "content-type": "application/json" } }))).status, 401);

  const redirecting = createProviderProxyResponder({
    exactOrigins,
    childToken,
    parentCredential,
    operationId: "operation-1",
    attemptId: "attempt-1",
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.example/v1/responses" } }),
    now: () => new Date(now)
  });
  assert.equal((await redirecting(request())).status, 403);

  const missingUsage = createProviderProxyResponder({
    exactOrigins,
    childToken,
    parentCredential,
    operationId: "operation-1",
    attemptId: "attempt-1",
    fetchImpl: async () => new Response(JSON.stringify({ id: "resp-1" }), { status: 200, headers: { "content-type": "application/json" } }),
    now: () => new Date(now)
  });
  const result = await missingUsage(request());
  assert.equal(result.status, 502);
  assert.match(JSON.parse(result.body).error, /usage_unavailable/);
});

test("provider proxy passes through Responses SSE and extracts usage", async () => {
  let forwarded;
  const sse = [
    "event: response.completed",
    'data: {"type":"response.completed","response":{"id":"resp-2","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4,"input_tokens_details":{"cached_tokens":0}}}}',
    "",
    ""
  ].join("\n");
  const respond = createProviderProxyResponder({
    exactOrigins,
    childToken,
    parentCredential,
    operationId: "operation-1",
    attemptId: "attempt-1",
    fetchImpl: async (_url, init) => {
      forwarded = init;
      return new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" }
      });
    },
    now: () => new Date(now)
  });
  const response = await respond(request({
    body: JSON.stringify({ model: "gpt-approved", input: "hello", max_output_tokens: 8, stream: true, stream_options: { include_usage: true } })
  }));
  assert.equal(response.status, 200);
  assert.equal(forwarded.headers["content-type"], "application/json");
  const body = JSON.parse(forwarded.body);
  assert.equal(body.stream, true);
  assert.match(response.headers["content-type"], /text\/event-stream/);
  assert.match(response.body, /event: response\.completed/);
  assert.match(response.body, /"usage"/);
});

test("provider proxy strips ChatGPT-unsupported params and adds ChatGPT-Account-Id", async () => {
  let forwarded;
  const sse = [
    "event: response.completed",
    'data: {"type":"response.completed","response":{"id":"resp-chatgpt","usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}}',
    "",
    ""
  ].join("\n");
  const respond = createProviderProxyResponder({
    exactOrigins: ["https://chatgpt.com"],
    childToken,
    parentCredential,
    chatgptAccountId: "acct-proxy-test",
    chatgptMode: true,
    operationId: "operation-1",
    attemptId: "attempt-1",
    fetchImpl: async (url, init) => {
      forwarded = { url, init };
      return new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" }
      });
    },
    now: () => new Date(now)
  });
  const response = await respond({
    method: "POST",
    url: "/backend-api/codex/responses",
    headers: { authorization: `Bearer ${childToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-sol",
      input: "hello",
      max_output_tokens: 64,
      max_tokens: 64,
      temperature: 0.2,
      stream: false
    })
  });
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, "https://chatgpt.com/backend-api/codex/responses");
  assert.equal(forwarded.init.headers.authorization, `Bearer ${parentCredential}`);
  assert.equal(forwarded.init.headers["ChatGPT-Account-Id"], "acct-proxy-test");
  const body = JSON.parse(forwarded.init.body);
  assert.equal(body.stream, true);
  assert.equal(Object.hasOwn(body, "max_output_tokens"), false);
  assert.equal(Object.hasOwn(body, "max_tokens"), false);
  assert.equal(Object.hasOwn(body, "temperature"), false);
  assert.equal(body.model, "gpt-5.6-sol");
});

