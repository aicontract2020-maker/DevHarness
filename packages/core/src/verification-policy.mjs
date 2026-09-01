const FEATURE_LEVELS = ["unit", "integration", "functional", "system"];
const RELEASE_LEVELS = [...FEATURE_LEVELS, "deployment", "rollback", "performance", "postdeploy"];
const DRIVERS = {
  unit: new Set(["node-test", "vitest", "jest", "pytest", "native-test"]),
  integration: new Set(["postgres-test", "database-test", "api-test", "container-test"]),
  functional: new Set(["browser", "playwright", "simulator", "device", "pty"]),
  system: new Set(["browser", "playwright", "simulator", "device", "pty", "system-test"]),
  deployment: new Set(["deployment-script"]),
  migration: new Set(["migration-script"]),
  rollback: new Set(["rollback-script"]),
  performance: new Set(["load", "k6", "locust"]),
  postdeploy: new Set(["canary"])
};

function add(reasons, code, summary, subject) {
  reasons.push({ code, summary, ...(subject ? { subject } : {}) });
}

export function evaluateVerificationPolicy(policy) {
  const reasons = [];
  const stages = Array.isArray(policy?.stages) ? policy.stages : [];
  const required = new Map(stages.filter((stage) => stage.required).map((stage) => [stage.level, stage]));
  const levels = policy?.work_type === "release" ? RELEASE_LEVELS : policy?.work_type === "feature" ? FEATURE_LEVELS : ["unit"];

  if (new Set(stages.map((stage) => stage.id)).size !== stages.length) add(reasons, "stage_id_duplicate", "Verification stage IDs must be unique.");
  if (new Set(stages.map((stage) => stage.level)).size !== stages.length) add(reasons, "stage_level_duplicate", "Verification stage levels must be unique.");
  for (const stage of stages) {
    if (!stage.drivers?.some((driver) => DRIVERS[stage.level]?.has(driver))) add(reasons, "driver_unregistered", `Stage ${stage.id} has no registered driver for ${stage.level}.`, stage.id);
  }

  const stageIds = new Set(stages.map((stage) => stage.id));
  for (const module of policy?.modules ?? []) {
    if (module.changed && !module.not_applicable_reason && (!module.unit_stage_id || !stageIds.has(module.unit_stage_id) || stages.find((stage) => stage.id === module.unit_stage_id)?.level !== "unit")) add(reasons, "module_unit_proof_missing", `Changed module ${module.id} lacks an applicable unit proof stage.`, module.id);
  }

  for (const level of levels) {
    if (!required.has(level)) add(reasons, "required_stage_missing", `Required ${level} proof stage is missing.`, level);
  }

  if ((policy?.platforms ?? []).includes("web")) {
    const functional = required.get("functional");
    if (functional && !functional.drivers?.some((driver) => ["browser", "playwright"].includes(driver))) {
      add(reasons, "real_surface_missing", "Web functional proof requires a browser driver.", functional.id);
    }
    if (functional && !functional.evidence_types?.some((type) => ["screenshot", "browser-snapshot"].includes(type))) {
      add(reasons, "browser_evidence_missing", "Web functional proof requires observable browser evidence, not an API or exit code alone.", functional.id);
    }
    const system = required.get("system");
    if (system && !system.evidence_types?.includes("network")) {
      add(reasons, "network_evidence_missing", "Web system proof must observe the frontend/backend request boundary.", system.id);
    }
  }

  const integration = required.get("integration");
  if (integration && integration.real_dependencies !== true) {
    add(reasons, "real_dependency_missing", "Integration proof must exercise real disposable dependencies.", integration.id);
  }
  for (const level of ["functional", "system"]) {
    const stage = required.get(level);
    if (stage && stage.real_dependencies !== true) add(reasons, "real_dependency_missing", `${level} proof must exercise the real configured system dependencies.`, stage.id);
  }

  if (policy?.impacts?.database) {
    if (!integration?.evidence_types?.includes("database-state") || !required.get("system")?.evidence_types?.includes("database-state")) {
      add(reasons, "database_state_missing", "Database-impacting work requires real database-state evidence at integration and system levels.", "database");
    }
    if (policy?.work_type === "release" && !required.has("migration")) {
      add(reasons, "required_stage_missing", "A database-impacting release requires an executable migration stage.", "migration");
    }
  }

  for (const level of ["functional", "system", "deployment", "migration", "rollback", "performance", "postdeploy"]) {
    const stage = required.get(level);
    if (stage && stage.independent !== true) add(reasons, "independent_proof_missing", `Required ${level} proof must be independent of the behavior-critical implementation.`, stage.id);
  }

  const performance = required.get("performance");
  if (performance && (!Array.isArray(performance.thresholds) || performance.thresholds.length === 0)) {
    add(reasons, "performance_threshold_missing", "Performance proof requires at least one numeric threshold.", performance.id);
  }
  if (performance?.thresholds?.some((threshold) => threshold.value < 0)) add(reasons, "performance_threshold_invalid", "Performance thresholds cannot use negative target values.", performance.id);

  if (policy?.work_type === "release") {
    const releaseContract = policy.release_contract ?? {};
    for (const field of ["deployment", "rollback", "performance", "canary"]) if (releaseContract[field] !== true) add(reasons, "release_contract_incomplete", `Release contract must require ${field} proof.`, field);
    if (policy?.impacts?.database && releaseContract.migration !== true) add(reasons, "release_contract_incomplete", "A database-impacting release contract must require migration proof.", "migration");
    const evidenceByLevel = { deployment: "deployment", migration: "migration", rollback: "rollback", performance: "metric", postdeploy: "canary-result" };
    for (const [level, evidenceType] of Object.entries(evidenceByLevel)) {
      const stage = required.get(level);
      if (stage && !stage.evidence_types?.includes(evidenceType)) add(reasons, "release_evidence_missing", `${level} stage lacks ${evidenceType} evidence.`, stage.id);
    }
  }

  return { valid: reasons.length === 0, reasons };
}
