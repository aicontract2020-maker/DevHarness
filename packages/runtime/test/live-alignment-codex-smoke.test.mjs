import test from "node:test";

const enabled = process.platform === "darwin" && process.env.DVH_ENABLE_REAL_CODEX_SMOKE === "1";

test(enabled ? "real Codex smoke is enabled" : "real Codex smoke stays opt-in", { skip: !enabled }, async () => {
  // This proof is intentionally gated behind an explicit developer opt-in on macOS.
  // The test file exists so the smoke path is documented and discoverable without
  // turning on a production credential or a non-local browser surface by default.
});
