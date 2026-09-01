import { createHash } from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/;
const DOMAIN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACCOUNTING_PATHS = [
  /^attempts\/(?:analysis-plan|analysis-synthesis|analysis-validation)\/[12]\/(?:reservation|attempt)\.json$/,
  /^outbound\/(?:provider|research)\/(?:[1-9]|1\d|2[0-5])\/reservation\.json$/,
  /^outbound\/provider\/(?:[1-9]|[1-9]\d|1[01]\d|120)\/receipt\.json$/,
  /^outbound\/research\/(?:[1-9]|1\d|2[0-5])\/terminal\/(?:manifest|receipt|source|gap)\.json$/
];

function canonicalValue(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Canonical JSON numbers must be safe integers.");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Canonical records must be JSON-compatible.");
  if (ancestors.has(value)) throw new TypeError("Canonical records must be JSON-compatible and acyclic.");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("Canonical records must contain only JSON-compatible plain objects.");
  }

  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => canonicalValue(item, ancestors));
  } else {
    result = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
        throw new TypeError("Canonical records must be JSON-compatible without omitted values.");
      }
      result[key] = canonicalValue(item, ancestors);
    }
  }
  ancestors.delete(value);
  return result;
}

function withoutTopLevelFields(value, excludedFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (excludedFields.length > 0) throw new TypeError("Digest exclusions require an object value.");
    return value;
  }
  const excluded = new Set(excludedFields);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!excluded.has(key)) result[key] = item;
  }
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalDigest(type, value, excludedFields = []) {
  if (typeof type !== "string" || !DOMAIN.test(type)) throw new TypeError("Canonical digest type must be a stable lowercase domain name.");
  if (!Array.isArray(excludedFields) || excludedFields.some((field) => typeof field !== "string")) {
    throw new TypeError("Canonical digest exclusions must be field names.");
  }
  const preimage = { domain: `devharness/${type}/v1`, value: withoutTopLevelFields(value, excludedFields) };
  return createHash("sha256").update(canonicalJson(preimage), "utf8").digest("hex");
}

export function canonicalRecordId(type, record, excludedFields = ["id"]) {
  return `${type}-${canonicalDigest(type, record, excludedFields)}`;
}

function assertAccountingEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "sha256,storage_key") {
    throw new TypeError("Accounting entries must contain exactly storage_key and sha256.");
  }
  if (typeof entry.storage_key !== "string" || entry.storage_key.startsWith("/") || entry.storage_key.includes("\\") || entry.storage_key.split("/").includes("..")) {
    throw new Error("Accounting entry has an unsafe storage key.");
  }
  if (!ACCOUNTING_PATHS.some((pattern) => pattern.test(entry.storage_key))) throw new Error(`Accounting entry uses an unlisted path: ${entry.storage_key}`);
  if (!SHA256.test(entry.sha256)) throw new Error("Accounting entry digest is invalid.");
}

export function operationAccountingHead(inputEntries) {
  if (!Array.isArray(inputEntries)) throw new TypeError("Accounting entries must be an array.");
  const entries = inputEntries.map((entry) => ({ ...entry }));
  for (const entry of entries) assertAccountingEntry(entry);
  const paths = new Set();
  for (const { storage_key: storageKey } of entries) {
    if (paths.has(storageKey)) throw new Error(`Accounting entries contain a duplicate path: ${storageKey}`);
    paths.add(storageKey);
  }

  const terminalGroups = new Map();
  for (const { storage_key: storageKey } of entries) {
    const match = /^(outbound\/research\/\d+\/terminal)\/(manifest|receipt|source|gap)\.json$/.exec(storageKey);
    if (!match) continue;
    const names = terminalGroups.get(match[1]) ?? new Set();
    names.add(match[2]);
    terminalGroups.set(match[1], names);
  }
  for (const names of terminalGroups.values()) {
    if (!names.has("manifest") || !names.has("receipt") || Number(names.has("source")) + Number(names.has("gap")) !== 1 || names.size !== 3) {
      throw new Error("Research terminal accounting must contain manifest, receipt, and exactly one source or gap.");
    }
  }

  entries.sort((left, right) => Buffer.compare(Buffer.from(left.storage_key), Buffer.from(right.storage_key)));
  return canonicalDigest("operation-accounting-head", entries);
}
