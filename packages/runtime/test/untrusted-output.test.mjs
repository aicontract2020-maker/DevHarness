import assert from "node:assert/strict";
import test from "node:test";

import { promoteUntrustedOutput } from "../src/untrusted-output.mjs";

function closedResultValidator(value) {
  const valid = value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => ["summary", "items"].includes(key))
    && typeof value.summary === "string"
    && Array.isArray(value.items)
    && value.items.every((item) => typeof item === "string");
  return { valid, errors: valid ? [] : [{ path: "$", message: "closed result required" }] };
}

const promote = (value, options = {}) => promoteUntrustedOutput({
  rawBytes: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
  validate: closedResultValidator,
  credentialValues: ["runtime-secret-value", "provider-secret-value"],
  ...options
});

test("valid Agent output is neutralized and only canonical sanitized bytes are promotable", () => {
  const result = promote({ summary: "<script>alert(1)</script>\u001b[31m\u0000", items: ["safe"] });
  assert.deepEqual(result.record, { items: ["safe"], summary: "&lt;script&gt;alert(1)&lt;/script&gt;[31m" });
  assert.equal(result.canonicalBytes.toString(), '{"items":["safe"],"summary":"&lt;script&gt;alert(1)&lt;/script&gt;[31m"}');
  assert.deepEqual(JSON.parse(result.canonicalBytes), result.record);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(result).sort(), ["canonicalBytes", "record", "sha256"]);
  assert.equal(result.canonicalBytes.includes(Buffer.from("<script>")), false);
});

test("known runtime and provider credential values are rejected anywhere in strings", () => {
  assert.throws(() => promote({ summary: "runtime-secret-value", items: [] }), (error) => error.code === "INVALID_OUTPUT" && /credential/.test(error.message));
  assert.throws(() => promote({ summary: "prefix provider-secret-value suffix", items: [] }), (error) => error.code === "INVALID_OUTPUT" && /credential/.test(error.message));
  assert.doesNotThrow(() => promote({ summary: "ordinary public text", items: [] }, { credentialValues: ["", null, undefined] }));
});

test("private keys and recognizable credential/token patterns fail closed", () => {
  const hostile = [
    "-----BEGIN PRIVATE KEY-----",
    "ghp_123456789012345678901234567890123456",
    "sk-1234567890123456789012345678901234567890",
    "AKIA1234567890ABCDEF"
  ];
  for (const secret of hostile) {
    assert.throws(() => promote({ summary: secret, items: [] }), (error) => error.code === "INVALID_OUTPUT" && /secret pattern/.test(error.message));
  }
});

test("oversized, malformed, non-object, unknown-field, and schema-invalid output is rejected", () => {
  assert.throws(() => promote("{"), (error) => error.code === "INVALID_OUTPUT" && /JSON/.test(error.message));
  assert.throws(() => promote([]), (error) => error.code === "INVALID_OUTPUT" && /schema/.test(error.message));
  assert.throws(() => promote({ summary: "safe", items: [], authority: "agent-approved" }), (error) => error.code === "INVALID_OUTPUT" && /schema/.test(error.message));
  assert.throws(() => promote({ summary: "x".repeat(1024), items: [] }, { maxBytes: 100 }), (error) => error.code === "INVALID_OUTPUT" && /size/.test(error.message));
});

test("input bytes and validation failures are neither mutated nor exposed as promotable output", () => {
  const rawBytes = Buffer.from('{"summary":"safe","items":[],"extra":"raw-only"}');
  const before = Buffer.from(rawBytes);
  let error;
  try {
    promoteUntrustedOutput({ rawBytes, validate: closedResultValidator, credentialValues: [] });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.code, "INVALID_OUTPUT");
  assert.deepEqual(rawBytes, before);
  assert.equal(Object.hasOwn(error, "rawBytes"), false);
  assert.equal(JSON.stringify(error).includes("raw-only"), false);
});
