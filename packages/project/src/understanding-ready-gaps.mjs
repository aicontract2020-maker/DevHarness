/**
 * Human-readable gaps between a Phase 1 draft bundle and understanding-ready.
 */

import { evaluateCurrentRepositoryUnderstanding } from "./understanding.mjs";

export function formatUnderstandingReadyGaps(evaluation, {
  baseline = null,
  strategy = null
} = {}) {
  const ready = evaluation?.verdict?.ready === true;
  const reasons = evaluation?.verdict?.reasons ?? [];
  const lines = [
    "## Path to understanding-ready",
    "",
    ready
      ? "- Verdict: **ready**"
      : `- Verdict: **not ready** (${reasons.length} blocker${reasons.length === 1 ? "" : "s"})`,
    ""
  ];
  if (!ready) {
    for (const reason of reasons.slice(0, 24)) {
      const subject = reason.subject ? ` · subject \`${reason.subject}\`` : "";
      lines.push(`- \`${reason.code}\`: ${reason.summary}${subject}`);
    }
    lines.push("");
  }
  if (strategy) {
    lines.push(
      "### Strategy gate",
      "",
      `- Current strategy: \`${strategy.id}\` · status **${strategy.status}**`,
      strategy.status === "proposed"
        ? "- Next: `devharness request-approval --run <ID> --for-strategy` then foreground `approve`"
        : "- Strategy status is approved; ensure a matching strategy-gate receipt exists for this revision",
      ""
    );
  }
  if (baseline) {
    lines.push(
      "### Baseline verdict field",
      "",
      `- Stored baseline verdict remains \`${baseline.verdict}\` until live proof promotes it (static onboard never writes \`ready\`).`,
      ""
    );
  }
  return lines.join("\n");
}

export async function evaluatePhase1ReadyGaps(repositoryRoot, {
  baseline,
  systemModel,
  strategy,
  goalImpact = {}
}) {
  const evaluation = await evaluateCurrentRepositoryUnderstanding(repositoryRoot, {
    baseline,
    systemModels: systemModel ? [systemModel] : [],
    strategies: strategy ? [strategy] : [],
    goalImpact
  });
  return {
    evaluation,
    markdown: formatUnderstandingReadyGaps(evaluation, { baseline, strategy })
  };
}
