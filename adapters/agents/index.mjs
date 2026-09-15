import { createCodexAdapter } from "./codex/index.mjs";
import { createLocalReadonlyAnalysisAdapter, LOCAL_READONLY_ADAPTER_ID } from "./local-readonly/index.mjs";

export function registerBuiltinAgentAdapters(registry, options = {}) {
  registry.register(LOCAL_READONLY_ADAPTER_ID, createLocalReadonlyAnalysisAdapter(options.localReadonly));
  if (options.codex !== false && options.includeCodex) {
    registry.register("codex", createCodexAdapter(options.codex));
  }
  return registry;
}

export { createCodexAdapter, createLocalReadonlyAnalysisAdapter, LOCAL_READONLY_ADAPTER_ID };
