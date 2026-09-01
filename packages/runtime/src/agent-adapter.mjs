import { canonicalDigest } from "./canonical-records.mjs";

const DESCRIPTOR_KEYS = ["control_plane_origins", "descriptor_sha256", "executable_sha256", "executable_version", "features", "id", "implementation_sha256", "model_id", "modes", "profile_id", "profile_template_sha256", "protocol_version", "schema_version", "version"];
const FEATURE_KEYS = ["built_in_web_disable", "ephemeral_session", "explicit_cancel", "read_only_tool_policy", "structured_output", "trusted_usage"];
const OUTPUT_KEYS = ["adapter_diagnostics", "completed_at", "exit_code", "result_path", "started_at", "status", "termination_reason", "usage"];
const USAGE_KEYS = ["input_tokens", "output_tokens", "total_tokens"];
const TERMINAL_STATUS = new Set(["succeeded", "blocked", "failed", "cancelled", "timed-out"]);
const TERMINATION_REASON = new Set(["completed", "authority", "unsupported", "cancelled", "timeout", "process-exit", "invalid-output", "limit", "isolation", "integrity", "cleanup"]);
const STABLE_ERROR_CODE = new Set(["ADAPTER_NOT_FOUND", "ADAPTER_INCOMPATIBLE", "ADAPTER_CHANGED", "AUTH_UNAVAILABLE", "ISOLATION_UNAVAILABLE", "CANCELLED", "TIMEOUT", "PROCESS_EXIT", "INVALID_OUTPUT", "RESOURCE_LIMIT", "USAGE_UNAVAILABLE", "CLEANUP_FAILED", "ANALYSIS_FAILED", "ANALYSIS_CONFLICT", "ANALYSIS_INCOMPLETE"]);
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

export class AgentAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentAdapterError";
    this.code = code;
  }
}

function keysEqual(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === expected.slice().sort().join("\0");
}

function deepFreeze(value, ancestors = new Set()) {
  if (!value || typeof value !== "object" || ancestors.has(value)) return value;
  ancestors.add(value);
  for (const child of Object.values(value)) deepFreeze(child, ancestors);
  ancestors.delete(value);
  return Object.freeze(value);
}

function immutableClone(value) {
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    throw new AgentAdapterError("INVALID_OUTPUT", "Portable Agent invocation must be structured-clone compatible.");
  }
}

function validateDescriptor(name, descriptor, profileId) {
  if (!keysEqual(descriptor, DESCRIPTOR_KEYS)) throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", "Agent descriptor must use the exact portable fields.");
  if (descriptor.schema_version !== 1 || descriptor.protocol_version !== 1 || descriptor.id !== name || !IDENTIFIER.test(descriptor.id)) throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", "Agent descriptor identity or protocol is incompatible.");
  if (profileId !== undefined && descriptor.profile_id !== profileId) throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", "Agent execution profile does not match the requested profile.");
  if (!keysEqual(descriptor.features, FEATURE_KEYS) || FEATURE_KEYS.some((key) => descriptor.features[key] !== true)) throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", "Agent adapter lacks a required safety feature.");
  if (!Array.isArray(descriptor.modes) || descriptor.modes.join("\0") !== "analysis-plan\0analysis-synthesis\0analysis-validation") throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", "Agent adapter modes are incompatible.");
  if (![descriptor.implementation_sha256, descriptor.executable_sha256, descriptor.profile_template_sha256, descriptor.descriptor_sha256].every((value) => typeof value === "string" && SHA256.test(value))) throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", "Agent descriptor contains an invalid digest.");
  const expected = canonicalDigest("agent-descriptor", descriptor, ["descriptor_sha256"]);
  if (descriptor.descriptor_sha256 !== expected) throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", "Agent descriptor digest does not match its contents.");
  if (!Array.isArray(descriptor.control_plane_origins) || descriptor.control_plane_origins.length < 1 || descriptor.control_plane_origins.length > 5 || descriptor.control_plane_origins.some((origin) => !/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(origin))) throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", "Agent descriptor provider origins are invalid.");
  for (const key of ["version", "profile_id", "model_id", "executable_version"]) {
    if (typeof descriptor[key] !== "string" || descriptor[key].length < 1 || descriptor[key].length > 256) throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", `Agent descriptor ${key} is invalid.`);
  }
  return deepFreeze(structuredClone(descriptor));
}

function validateUsage(usage) {
  if (!keysEqual(usage, USAGE_KEYS)) return false;
  if (USAGE_KEYS.some((key) => !Number.isSafeInteger(usage[key]) || usage[key] < 0 || usage[key] > 600000)) return false;
  return usage.total_tokens === usage.input_tokens + usage.output_tokens;
}

function validateOutput(output) {
  if (!keysEqual(output, OUTPUT_KEYS) || !TERMINAL_STATUS.has(output.status) || !TERMINATION_REASON.has(output.termination_reason)) return false;
  if (!Number.isFinite(Date.parse(output.started_at)) || !Number.isFinite(Date.parse(output.completed_at))) return false;
  if (!(output.exit_code === null || (Number.isInteger(output.exit_code) && output.exit_code >= -2147483648 && output.exit_code <= 2147483647))) return false;
  if (!(output.result_path === null || (typeof output.result_path === "string" && output.result_path.startsWith("/") && output.result_path.length <= 4096))) return false;
  if (!validateUsage(output.usage) || !Array.isArray(output.adapter_diagnostics) || output.adapter_diagnostics.length > 20) return false;
  for (const diagnostic of output.adapter_diagnostics) {
    if (!keysEqual(diagnostic, ["code", "summary"]) || !STABLE_ERROR_CODE.has(diagnostic.code) || typeof diagnostic.summary !== "string" || diagnostic.summary.length < 1 || diagnostic.summary.length > 1000) return false;
  }
  if (output.status === "succeeded" && (output.termination_reason !== "completed" || output.exit_code !== 0 || output.result_path === null)) return false;
  if (output.status !== "succeeded" && output.result_path !== null) return false;
  return true;
}

export class AgentAdapterRegistry {
  #adapters = new Map();

  register(name, adapter) {
    if (!IDENTIFIER.test(name)) throw new TypeError("Agent adapter name is invalid.");
    if (!adapter || ["probe", "start", "cancel"].some((method) => typeof adapter[method] !== "function")) throw new TypeError("Agent adapter requires probe, start, and cancel methods.");
    if (this.#adapters.has(name)) throw new Error(`Agent adapter ${name} is already registered.`);
    this.#adapters.set(name, adapter);
    return this;
  }

  #resolve(name) {
    const adapter = this.#adapters.get(name);
    if (!adapter) throw new AgentAdapterError("ADAPTER_NOT_FOUND", `Agent adapter ${name} is not registered.`);
    return adapter;
  }

  async probe(name, options = {}) {
    const adapter = this.#resolve(name);
    let descriptor;
    try {
      descriptor = await adapter.probe({ environment: options.environment ?? {}, profileId: options.profileId });
    } catch (error) {
      if (error instanceof AgentAdapterError) throw error;
      throw new AgentAdapterError("ADAPTER_INCOMPATIBLE", "Agent adapter probe failed.");
    }
    return validateDescriptor(name, descriptor, options.profileId);
  }

  async start(name, { invocation, executionContext, signal, onStatus } = {}) {
    const adapter = this.#resolve(name);
    let output;
    try {
      output = await adapter.start({ invocation: immutableClone(invocation), executionContext, signal, onStatus });
    } catch (error) {
      if (error instanceof AgentAdapterError) throw error;
      throw new AgentAdapterError("PROCESS_EXIT", "Agent adapter execution failed.");
    }
    if (!validateOutput(output)) throw new AgentAdapterError("INVALID_OUTPUT", "Agent adapter returned a non-portable terminal result.");
    return deepFreeze(structuredClone(output));
  }

  async cancel(name, { executionHandle, reason } = {}) {
    const adapter = this.#resolve(name);
    try {
      await adapter.cancel({ executionHandle, reason });
    } catch (error) {
      if (error instanceof AgentAdapterError) throw error;
      throw new AgentAdapterError("CLEANUP_FAILED", "Agent adapter cancellation failed.");
    }
  }
}
