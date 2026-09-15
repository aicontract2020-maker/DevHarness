import { createCodexAdapter } from "./codex/index.mjs";
import { createLocalReadonlyAnalysisAdapter, LOCAL_READONLY_ADAPTER_ID } from "./local-readonly/index.mjs";
import { CODEX_ADAPTER_ID, defaultCodexProfile } from "../../packages/runtime/src/codex-runtime.mjs";

export function registerBuiltinAgentAdapters(registry, options = {}) {
  registry.register(LOCAL_READONLY_ADAPTER_ID, createLocalReadonlyAnalysisAdapter(options.localReadonly));
  if (options.codex !== false) {
    const given = options.codex && typeof options.codex === "object" ? options.codex : {};
    registry.register(CODEX_ADAPTER_ID, createCodexAdapter({
      ...given,
      profile: given.profile ?? defaultCodexProfile(given.environment ?? process.env)
    }));
  }
  return registry;
}

export {
  createCodexAdapter,
  createLocalReadonlyAnalysisAdapter,
  LOCAL_READONLY_ADAPTER_ID,
  CODEX_ADAPTER_ID
};
