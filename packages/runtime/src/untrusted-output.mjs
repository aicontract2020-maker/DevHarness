import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical-records.mjs";

const DEFAULT_MAX_BYTES = 1024 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/
];
const ACTIVE_OR_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/gu;

class InvalidOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidOutputError";
    this.code = "INVALID_OUTPUT";
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message };
  }
}

function invalid(message) {
  throw new InvalidOutputError(message);
}

function assertNoSecrets(value, credentialValues) {
  if (typeof value === "string") {
    for (const credential of credentialValues) {
      if (typeof credential === "string" && credential.length > 0 && value.includes(credential)) {
        invalid("Agent output contains a protected credential value.");
      }
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) invalid("Agent output contains a recognized secret pattern.");
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Array.isArray(value) ? value : Object.values(value)) assertNoSecrets(item, credentialValues);
  }
}

function neutralizeString(value) {
  return value
    .normalize("NFC")
    .replace(ACTIVE_OR_CONTROL, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function neutralize(value) {
  if (typeof value === "string") return neutralizeString(value);
  if (value === null || typeof value === "boolean" || Number.isSafeInteger(value)) return value;
  if (typeof value === "number") invalid("Agent output contains a non-integer number.");
  if (Array.isArray(value)) return value.map(neutralize);
  if (!value || typeof value !== "object") invalid("Agent output is not JSON-compatible.");
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) invalid("Agent output contains an unsafe object key.");
    const safeKey = neutralizeString(key);
    if (!safeKey || Object.hasOwn(result, safeKey)) invalid("Agent output contains an unsafe or duplicate normalized key.");
    result[safeKey] = neutralize(item);
  }
  return result;
}

function parseBoundedJson(rawBytes, maxBytes) {
  if (!Buffer.isBuffer(rawBytes) && !(rawBytes instanceof Uint8Array)) invalid("Agent output bytes are required.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) invalid("Agent output size limit is invalid.");
  if (rawBytes.byteLength > maxBytes) invalid("Agent output exceeds the allowed size.");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    invalid("Agent output is not valid UTF-8 JSON.");
  }
  try {
    return JSON.parse(text);
  } catch {
    invalid("Agent output is not valid JSON.");
  }
}

export function promoteUntrustedOutput({
  rawBytes,
  validate,
  credentialValues = [],
  maxBytes = DEFAULT_MAX_BYTES
} = {}) {
  if (typeof validate !== "function") invalid("Agent output schema validator is required.");
  const parsed = parseBoundedJson(rawBytes, maxBytes);
  assertNoSecrets(parsed, credentialValues);
  const record = neutralize(parsed);
  assertNoSecrets(record, credentialValues);

  let validation;
  try {
    validation = validate(record);
  } catch {
    invalid("Agent output schema validation failed.");
  }
  if (validation !== true && validation?.valid !== true) invalid("Agent output does not match the closed result schema.");

  const canonicalBytes = Buffer.from(canonicalJson(record), "utf8");
  if (canonicalBytes.byteLength > maxBytes) invalid("Sanitized Agent output exceeds the allowed size.");
  const sha256 = createHash("sha256").update(canonicalBytes).digest("hex");
  return { record, canonicalBytes, sha256 };
}

export { InvalidOutputError };
