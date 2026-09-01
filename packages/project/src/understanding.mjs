import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { evaluateUnderstandingBaseline } from "../../core/src/understanding-policy.mjs";
import { assertContract } from "./contracts.mjs";
import { discoverRepository } from "./discover.mjs";

// This is the only project-level entry point allowed to emit an understanding-ready verdict.
// Repository identity, revision and required coverage are derived from live discovery here;
// callers cannot supply or shrink them.
export async function evaluateCurrentRepositoryUnderstanding(repositoryRoot, {
  baseline,
  systemModels = [],
  strategies = [],
  goalImpact = {}
}) {
  const snapshot = await discoverRepository(repositoryRoot);
  await assertContract("repository-understanding-baseline", baseline);
  for (const model of systemModels) await assertContract("system-model", model);
  for (const strategy of strategies) await assertContract("design-strategy", strategy);
  const trustContext = await loadTrustedEvaluationContext({ snapshot, goalImpact });
  return {
    snapshot,
    verdict: evaluateUnderstandingBaseline(baseline, { trustContext, systemModels, strategies })
  };
}
