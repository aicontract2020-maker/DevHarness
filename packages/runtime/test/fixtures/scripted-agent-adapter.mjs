import { createHash } from "node:crypto";

import { canonicalDigest } from "../../src/canonical-records.mjs";

const FEATURES = Object.freeze({ structured_output: true, explicit_cancel: true, ephemeral_session: true, read_only_tool_policy: true, built_in_web_disable: true, trusted_usage: true });
const MODES = Object.freeze(["analysis-plan", "analysis-synthesis", "analysis-validation"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function success(script) {
  return {
    started_at: script.now,
    completed_at: script.now,
    exit_code: 0,
    usage: script.usage,
    status: "succeeded",
    termination_reason: "completed",
    result_path: script.resultPath,
    adapter_diagnostics: []
  };
}

function invalidOutput(script) {
  return {
    started_at: script.now,
    completed_at: script.now,
    exit_code: 0,
    usage: script.usage,
    status: "failed",
    termination_reason: "invalid-output",
    result_path: null,
    adapter_diagnostics: [{ code: "INVALID_OUTPUT", summary: "The Agent did not produce its required result file." }]
  };
}

export function createScriptedAgentAdapter({ profile, script, observe = () => {} } = {}) {
  if (!profile || !script) throw new TypeError("Scripted conformance adapter requires a profile and script.");
  let cancelled = false;
  return Object.freeze({
    async probe({ profileId } = {}) {
      if (profileId !== undefined && profileId !== profile.id) throw new Error("Unsupported scripted profile.");
      const descriptor = {
        schema_version: 1,
        id: "scripted",
        version: "1.0.0",
        protocol_version: 1,
        profile_id: profile.id,
        model_id: profile.modelId,
        executable_version: "scripted-1.0.0",
        modes: [...MODES],
        features: { ...FEATURES },
        implementation_sha256: sha256("scripted-agent-adapter-v1"),
        executable_sha256: sha256("scripted-agent-executable-v1"),
        profile_template_sha256: canonicalDigest("agent-profile-template", profile.template),
        control_plane_origins: [...profile.controlPlaneOrigins],
        descriptor_sha256: "pending"
      };
      descriptor.descriptor_sha256 = canonicalDigest("agent-descriptor", descriptor, ["descriptor_sha256"]);
      return descriptor;
    },
    async start(input) {
      observe(input);
      if (cancelled || script.outcome === "cancelled") {
        return { started_at: script.now, completed_at: script.now, exit_code: null, usage: script.usage, status: "cancelled", termination_reason: "cancelled", result_path: null, adapter_diagnostics: [{ code: "CANCELLED", summary: "The Agent attempt was cancelled." }] };
      }
      if (script.outcome === "success") return success(script);
      if (script.outcome === "invalid-output") return invalidOutput(script);
      throw new Error(`Unsupported scripted outcome: ${script.outcome}`);
    },
    async cancel() {
      cancelled = true;
    }
  });
}
