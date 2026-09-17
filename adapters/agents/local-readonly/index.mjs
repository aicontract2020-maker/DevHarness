import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { canonicalDigest, canonicalJson } from "../../../packages/runtime/src/canonical-records.mjs";
import { buildLocalReadonlyAdapterPayload } from "../../../packages/runtime/src/local-readonly-artifacts.mjs";

const FEATURES = Object.freeze({
  structured_output: true,
  explicit_cancel: true,
  ephemeral_session: true,
  read_only_tool_policy: true,
  built_in_web_disable: true,
  trusted_usage: true
});
const MODES = Object.freeze(["analysis-plan", "analysis-synthesis", "analysis-validation"]);
const DEFAULT_PROFILE_ID = "codex-readonly-analysis-v1";
const DEFAULT_MODEL_ID = "local-readonly-analysis";
const ADAPTER_ID = "devharness-cli-local-agent";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nowIso(clock) {
  return (clock?.() ?? new Date()).toISOString();
}

/**
 * Dogfood / local readonly analysis adapter.
 * Exercises the real continue → runBoundedAgentWorker path without Codex binary or API keys.
 * Primary live adapter is builtin `codex` when Codex CLI + OPENAI_API_KEY /
 * DEVHARNESS_PROVIDER_CREDENTIAL are configured. This stub remains the CI/dogfood
 * fallback: `align --continue --agent devharness-cli-local-agent ...`.
 */
export function createLocalReadonlyAnalysisAdapter({
  profileId = DEFAULT_PROFILE_ID,
  modelId = DEFAULT_MODEL_ID,
  clock = () => new Date(),
  writeResult = async (resultPath, payload) => {
    await writeFile(resultPath, `${canonicalJson(payload)}\n`, "utf8");
  }
} = {}) {
  let cancelled = false;
  return Object.freeze({
    async probe({ profileId: requestedProfileId } = {}) {
      if (requestedProfileId !== undefined && requestedProfileId !== profileId) {
        throw new Error("Unsupported local readonly analysis profile.");
      }
      const descriptor = {
        schema_version: 1,
        id: ADAPTER_ID,
        version: "devharness-cli-local-live-v1",
        protocol_version: 1,
        profile_id: profileId,
        model_id: modelId,
        executable_version: "devharness-cli",
        modes: [...MODES],
        features: { ...FEATURES },
        implementation_sha256: sha256("devharness-cli-local-readonly-analysis-adapter-v2"),
        executable_sha256: sha256(process.execPath),
        profile_template_sha256: canonicalDigest("agent-profile-template", {
          id: profileId,
          sandbox: "read-only",
          mode: "local-stub"
        }),
        control_plane_origins: ["https://devharness.local"],
        descriptor_sha256: "pending"
      };
      descriptor.descriptor_sha256 = canonicalDigest("agent-descriptor", descriptor, ["descriptor_sha256"]);
      return descriptor;
    },

    async start({ invocation, executionContext, signal } = {}) {
      const startedAt = nowIso(clock);
      if (cancelled || signal?.aborted) {
        return {
          started_at: startedAt,
          completed_at: nowIso(clock),
          exit_code: null,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          status: "cancelled",
          termination_reason: "cancelled",
          result_path: null,
          adapter_diagnostics: [{ code: "CANCELLED", summary: "The local readonly analysis attempt was cancelled." }]
        };
      }
      if (!executionContext?.resultPath) {
        return {
          started_at: startedAt,
          completed_at: nowIso(clock),
          exit_code: 1,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          status: "failed",
          termination_reason: "invalid-output",
          result_path: null,
          adapter_diagnostics: [{ code: "INVALID_OUTPUT", summary: "Local readonly analysis requires a result path." }]
        };
      }
      const phase = invocation?.phase ?? "analysis-plan";
      let payload;
      if (phase === "change-proposal") {
        const seeded = invocation?.fixture_change;
        if (seeded && typeof seeded === "object") {
          payload = {
            schema_version: 1,
            phase: "change-proposal",
            summary: typeof seeded.summary === "string" ? seeded.summary : "Local readonly change proposal from fixture_change.",
            changes: Array.isArray(seeded.changes) ? seeded.changes : [seeded],
            notes: ["emitted-by-local-readonly-adapter"]
          };
        } else {
          const goalText = invocation?.goal?.refined ?? invocation?.goal?.original ?? "DevHarness controlled change";
          payload = {
            schema_version: 1,
            phase: "change-proposal",
            summary: `Local readonly proposal for: ${String(goalText).slice(0, 180)}`,
            changes: [{
              kind: "ensure-file",
              relative_path: "DEVHARNESS_AGENT_PROPOSED_CHANGE.md",
              contents: [
                "# DevHarness agent-proposed change",
                "",
                `- Goal: ${goalText}`,
                `- Adapter: ${ADAPTER_ID}`,
                "",
                "Emitted by the local readonly adapter under change-proposal phase.",
                "Runtime applies this only after schema validation inside controlled-change.",
                ""
              ].join("\n")
            }],
            notes: ["emitted-by-local-readonly-adapter"]
          };
        }
      } else {
        payload = buildLocalReadonlyAdapterPayload({
          phase,
          invocation,
          profileId,
          adapterId: ADAPTER_ID
        });
      }
      await writeResult(executionContext.resultPath, payload);
      const completedAt = nowIso(clock);
      return {
        started_at: startedAt,
        completed_at: completedAt,
        exit_code: 0,
        usage: { input_tokens: 0, output_tokens: 8, total_tokens: 8 },
        status: "succeeded",
        termination_reason: "completed",
        result_path: executionContext.resultPath,
        adapter_diagnostics: []
      };
    },

    async cancel() {
      cancelled = true;
    }
  });
}

export { ADAPTER_ID as LOCAL_READONLY_ADAPTER_ID, DEFAULT_PROFILE_ID as LOCAL_READONLY_PROFILE_ID };
