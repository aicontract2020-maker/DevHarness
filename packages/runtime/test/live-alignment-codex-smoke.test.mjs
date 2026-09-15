import assert from "node:assert/strict";
import test from "node:test";

import { createCodexAdapter } from "../../../adapters/agents/codex/index.mjs";
import { defaultCodexProfile, resolveCodexExecutable, resolveProviderCredential } from "../src/codex-runtime.mjs";

const enabled = process.platform === "darwin" && process.env.DVH_ENABLE_REAL_CODEX_SMOKE === "1";

test(enabled ? "real Codex smoke is enabled" : "real Codex smoke stays opt-in", { skip: !enabled }, async () => {
  const environment = process.env;
  const executable = await resolveCodexExecutable(environment);
  const credential = resolveProviderCredential(environment);
  assert.ok(executable, "set DEVHARNESS_CODEX_PATH or put `codex` on PATH");
  assert.ok(credential, "export OPENAI_API_KEY or DEVHARNESS_PROVIDER_CREDENTIAL; DevHarness does not read ~/.codex/auth.json");
  const adapter = createCodexAdapter({ profile: defaultCodexProfile(environment) });
  const descriptor = await adapter.probe({ environment, profileId: "codex-readonly-analysis-v1" });
  assert.equal(descriptor.id, "codex");
  assert.equal(descriptor.profile_id, "codex-readonly-analysis-v1");
  assert.deepEqual(descriptor.modes, ["analysis-plan", "analysis-synthesis", "analysis-validation"]);
});
