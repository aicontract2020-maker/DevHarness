/**
 * Pick a declared quality command for post-scope / controlled-change verify.
 * Never invents ids; only returns commands present in the harness config.
 */

function normalizeChangePaths(changeSpec) {
  if (!changeSpec) return [];
  const specs = Array.isArray(changeSpec.changes)
    ? changeSpec.changes
    : (changeSpec.kind ? [changeSpec] : []);
  return specs
    .map((item) => String(item?.relative_path ?? "").replace(/^\/+/, ""))
    .filter(Boolean);
}

function tokensFrom(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((token) => token.length >= 3);
}

function scoreCommand(command, { goalText, changePaths, deliveryMode }) {
  let score = 0;
  const haystack = [
    command.id,
    command.kind,
    command.run,
    command.source
  ].filter(Boolean).join("\n").toLowerCase();

  for (const relative of changePaths) {
    const lower = relative.toLowerCase();
    const base = lower.split("/").pop();
    if (haystack.includes(lower)) score += 50;
    else if (base && haystack.includes(base.replace(/\.[^.]+$/, ""))) score += 20;
    for (const part of lower.split("/").filter((p) => p.length >= 4)) {
      if (haystack.includes(part)) score += 8;
    }
  }

  const goalTokens = tokensFrom(goalText);
  for (const token of goalTokens) {
    if (haystack.includes(token)) score += 4;
  }

  if (deliveryMode === "docs-only" && command.id === "docs-readiness-summary") score += 30;
  if (deliveryMode === "controlled-change" && command.id === "controlled-change-marker") {
    const onlyMarker = changePaths.length === 0
      || changePaths.every((path) => path === "DEVHARNESS_CONTROLLED_CHANGE.md" || path.endsWith("/DEVHARNESS_CONTROLLED_CHANGE.md"));
    if (onlyMarker) score += 40;
  }
  if (deliveryMode === "controlled-change" && command.kind === "test") score += 3;
  if (command.kind === "build" || command.kind === "launch") score -= 5;

  return score;
}

/**
 * @returns {{ command_id: string|null, reason: string, candidates: Array<{id:string,score:number}> }}
 */
export function selectVerifyCommandId({
  commands = [],
  goalText = "",
  changeSpec = null,
  deliveryMode = "docs-only",
  explicitCommandId = null
} = {}) {
  const list = Array.isArray(commands) ? commands : [];
  if (explicitCommandId) {
    const found = list.find((command) => command?.id === explicitCommandId);
    if (!found) {
      return {
        command_id: null,
        reason: `Explicit --command ${explicitCommandId} is not in the harness quality commands.`,
        candidates: []
      };
    }
    return {
      command_id: found.id,
      reason: "explicit --command",
      candidates: [{ id: found.id, score: Number.POSITIVE_INFINITY }]
    };
  }

  const changePaths = normalizeChangePaths(changeSpec);
  const ranked = list
    .filter((command) => command && typeof command.id === "string")
    .map((command) => ({
      id: command.id,
      score: scoreCommand(command, { goalText, changePaths, deliveryMode })
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const best = ranked[0];
  if (!best || best.score <= 0) {
    return {
      command_id: null,
      reason: "No harness quality command scored above zero for this goal/change.",
      candidates: ranked.slice(0, 5)
    };
  }
  return {
    command_id: best.id,
    reason: changePaths.length
      ? `Matched declared command to changed paths (${changePaths.slice(0, 3).join(", ")}).`
      : "Matched declared command to goal text and delivery mode.",
    candidates: ranked.slice(0, 5)
  };
}

export function verifyHintFromReadiness(readiness, { runId } = {}) {
  const commandId = readiness?.verify_command_id ?? null;
  const changeSha = readiness?.change_commit_sha ?? null;
  if (!commandId || !runId) return null;
  const commitFlag = changeSha ? ` --commit ${changeSha}` : "";
  return `devharness verify --run ${runId} --command ${commandId}${commitFlag} --execute --attest`;
}
