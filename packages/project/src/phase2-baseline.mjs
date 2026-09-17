/**
 * Phase 2 (existing-project): stabilize baseline by proving configured quality
 * commands with current-revision Supervisor evidence.
 */

import { currentSupervisorManifest } from "./doctor.mjs";

const LADDER_KINDS = ["test", "build", "lint", "verify", "launch"];

function priorityFor(command) {
  if (command.id.includes("pytest") || command.id === "python-tests") return 10;
  if (command.kind === "test" && command.id.startsWith("frontend-test")) return 15;
  if (command.kind === "test" && (command.id.includes("docs-") || command.id.includes("controlled-change") || command.id.startsWith("health-"))) return 35;
  if (command.kind === "test") return 20;
  if (command.kind === "build") return 40;
  if (command.kind === "lint") return 50;
  if (command.kind === "launch") return 60;
  if (command.kind === "verify") return 70;
  return 100;
}

function commandHasCurrentEvidence(snapshot, config, trustContext, command) {
  if (!command?.id || !command?.kind) return false;
  const filtered = {
    ...trustContext,
    manifests: (trustContext?.manifests ?? []).filter((manifest) => manifest.command?.id === command.id)
  };
  return Boolean(currentSupervisorManifest(snapshot, config, filtered, command.kind));
}

/**
 * Rank configured quality commands and mark which already have matching
 * Supervisor manifests for the current revision + config.
 */
export function evaluatePhase2BaselineLadder({
  snapshot,
  config,
  trustContext,
  understandingReady = false
} = {}) {
  if (!config?.quality?.commands) {
    return {
      understanding_ready: understandingReady,
      ready: false,
      commands: [],
      next: null,
      proved_count: 0,
      total_count: 0,
      reasons: [{ code: "project_config_missing", summary: "Phase 2 needs a valid project declaration with quality commands." }]
    };
  }

  const ranked = [...config.quality.commands]
    .filter((command) => LADDER_KINDS.includes(command.kind))
    .sort((left, right) => priorityFor(left) - priorityFor(right) || left.id.localeCompare(right.id))
    .map((command) => ({
      id: command.id,
      kind: command.kind,
      proved: commandHasCurrentEvidence(snapshot, config, trustContext, command),
      priority: priorityFor(command),
      source: command.source
    }));

  const missing = ranked.filter((item) => !item.proved);
  const next = missing[0] ?? null;
  const reasons = [];
  if (!understandingReady) {
    reasons.push({ code: "understanding_not_ready", summary: "Phase 2 should follow Phase 1 understanding-ready." });
  }
  if (missing.length) {
    reasons.push({
      code: "baseline_commands_unproved",
      summary: `${missing.length} configured quality command(s) lack current-revision Supervisor evidence.`,
      subject: next?.id
    });
  }

  return {
    understanding_ready: understandingReady,
    ready: understandingReady && missing.length === 0,
    commands: ranked,
    next,
    proved_count: ranked.filter((item) => item.proved).length,
    total_count: ranked.length,
    reasons
  };
}

export function formatPhase2BaselineLadder(ladder) {
  const lines = [
    "## Path to Phase 2 baseline-stable",
    "",
    ladder.ready
      ? "- Ladder: **stable** (all configured quality commands have current Supervisor evidence)"
      : `- Ladder: **not stable** (${ladder.proved_count}/${ladder.total_count} proved)`,
    ""
  ];
  if (!ladder.understanding_ready) {
    lines.push("- Prerequisite: Phase 1 understanding is not ready yet.", "");
  }
  if (ladder.next) {
    lines.push(
      "### Next command",
      "",
      `- \`${ladder.next.id}\` (${ladder.next.kind})`,
      "- Create/use a Goal Run, approve verify capabilities, then:",
      `- \`devharness verify --command ${ladder.next.id} --run <ID> --execute --attest\``,
      ""
    );
  }
  lines.push("### Command ladder", "");
  for (const item of ladder.commands) {
    lines.push(`- ${item.proved ? "✓" : "○"} \`${item.id}\` (${item.kind})`);
  }
  lines.push("");
  return lines.join("\n");
}
