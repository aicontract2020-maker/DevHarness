/**
 * Draft Phase 1 products from static onboarding.
 * Honest: system-model stays needs-evidence; design-strategy stays proposed.
 * Never claims complete/approved without live evidence and a human gate.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { strategyArtifactHash } from "../../core/src/trusted-context.mjs";
import { assertContract } from "./contracts.mjs";
import { hashContract } from "./harness.mjs";

const SKIP_DIRS = new Set([
  ".git", "node_modules", ".venv", "venv", "dist", "build", "coverage",
  "__pycache__", ".next", ".turbo", "playwright-results", "aiedu_backend.egg-info",
  "uploads", "pilot", "loadtest", "docs", "deployments", ".cursor", "out"
]);
const MAX_ENTITIES = 32;
const MAX_FILES_SCAN = 4000;

function hasDomainSignal(claims, domain) {
  return (claims ?? []).some((claim) => claim.domain === domain && claim.status !== "not-covered");
}

function inferStoreKind(plan, snapshot) {
  const services = (snapshot?.detected?.services ?? []).map((item) => String(item).toLowerCase());
  const frameworks = (snapshot?.detected?.frameworks ?? []).map((item) => String(item).toLowerCase());
  const keys = [...(snapshot?.environment?.declared_keys ?? []), ...(plan?.summary?.environment_keys ?? [])].map((item) => String(item).toLowerCase());
  const haystack = [...services, ...frameworks, ...keys].join(" ");
  if (/postgres|postgresql/.test(haystack)) return "PostgreSQL";
  if (/mysql/.test(haystack)) return "MySQL";
  if (/sqlite/.test(haystack)) return "SQLite";
  if (/mongo/.test(haystack)) return "MongoDB";
  if (/redis/.test(haystack)) return "Redis";
  if (hasDomainSignal(plan.claims, "database")) return "detected-database";
  return null;
}

export function repositoryRootFromSnapshot(snapshot) {
  const uri = snapshot?.repository?.root_uri;
  if (!uri || typeof uri !== "string") return null;
  try {
    if (uri.startsWith("file:")) return fileURLToPath(uri);
  } catch {
    return null;
  }
  if (path.isAbsolute(uri)) return uri;
  return null;
}

function walkFiles(root, { maxFiles = MAX_FILES_SCAN } = {}) {
  const out = [];
  const stack = [root];
  while (stack.length > 0 && out.length < maxFiles) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (entry.isDirectory() && entry.name !== ".github") continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(path.join(current, entry.name));
        continue;
      }
      out.push(path.join(current, entry.name));
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

function toEntityId(tableName) {
  const slug = String(tableName).replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
  const id = `entity-${slug}`;
  return id.slice(0, 128);
}

function classifyTable(tableName, sourceText) {
  const classifications = [];
  const lower = `${tableName}\n${sourceText}`.toLowerCase();
  if (/(password|email|hashed_password|full_name|phone)/.test(lower) || tableName === "users") {
    classifications.push("personal");
  }
  if (/(token|secret|credential|api_key)/.test(lower)) classifications.push("credential");
  return [...new Set(classifications)];
}

function extractConstraints(classBody) {
  const constraints = [];
  if (/primary_key\s*=\s*True/.test(classBody)) constraints.push("primary key");
  const uniques = [...classBody.matchAll(/(\w+)\s*=\s*Column\([^)]*unique\s*=\s*True/g)].map((match) => match[1]);
  for (const column of uniques) constraints.push(`${column} unique`);
  const fks = [...classBody.matchAll(/ForeignKey\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  for (const fk of fks) constraints.push(`fk ${fk}`);
  return constraints.slice(0, 16);
}

function extractIndexes(classBody) {
  const indexes = [];
  const indexed = [...classBody.matchAll(/(\w+)\s*=\s*Column\([^)]*index\s*=\s*True/g)].map((match) => match[1]);
  for (const column of indexed) indexes.push(column);
  return [...new Set(indexes)].slice(0, 16);
}

/**
 * Static SQLAlchemy / Alembic scan → draft entities (no DB execution).
 */
export function deriveEntitiesFromRepositoryRoot(root, {
  storeId = "store-primary",
  ownerComponentId = "component-backend"
} = {}) {
  if (!root || !existsSync(root)) return { entities: [], migrationFiles: [], modelFiles: [], rawEntities: [] };

  const prioritized = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.isDirectory() && entry.name !== ".github") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        // Avoid scanning bulky database content except migration trees.
        if (entry.name === "database") {
          const versions = path.join(full, "migrations", "versions");
          if (existsSync(versions)) prioritized.push(versions);
          const alt = path.join(full, "versions");
          if (existsSync(alt)) prioritized.push(alt);
          continue;
        }
        if (entry.name === "models" || entry.name === "versions" || entry.name === "migrations" || entry.name === "alembic") {
          prioritized.push(full);
        }
        queue.push(full);
        continue;
      }
    }
  }

  const modelFiles = [];
  const migrationFiles = [];
  const seenFiles = new Set();
  for (const dir of prioritized) {
    for (const file of walkFiles(dir, { maxFiles: 2000 })) {
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);
      const normalized = file.replaceAll("\\", "/");
      if (/\/models\/.+\.py$/.test(normalized) && !normalized.endsWith("/__init__.py")) modelFiles.push(file);
      if (/\/(?:migrations|alembic)\/versions\/.+\.(?:py|sql)$/.test(normalized) || /\/versions\/.+\.(?:py|sql)$/.test(normalized)) {
        migrationFiles.push(file);
      }
    }
  }

  // Fallback: bounded repo walk if prioritization found nothing (tiny fixtures).
  if (modelFiles.length === 0 || migrationFiles.length === 0) {
    for (const file of walkFiles(root, { maxFiles: MAX_FILES_SCAN })) {
      if (seenFiles.has(file)) continue;
      const normalized = file.replaceAll("\\", "/");
      if (modelFiles.length === 0 && /\/models\/.+\.py$/.test(normalized) && !normalized.endsWith("/__init__.py")) {
        modelFiles.push(file);
      }
      if (migrationFiles.length === 0 && (/\/(?:migrations|alembic)\/versions\/.+\.(?:py|sql)$/.test(normalized) || /\/versions\/.+\.(?:py|sql)$/.test(normalized))) {
        migrationFiles.push(file);
      }
    }
  }

  const tableToMigrations = new Map();
  for (const file of migrationFiles) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const tables = new Set([
      ...[...text.matchAll(/create_table\(\s*["']([^"']+)["']/g)].map((match) => match[1]),
      ...[...text.matchAll(/op\.create_table\(\s*["']([^"']+)["']/g)].map((match) => match[1])
    ]);
    for (const table of tables) {
      const list = tableToMigrations.get(table) ?? [];
      list.push(rel);
      tableToMigrations.set(table, list);
    }
  }

  const entities = [];
  const seen = new Set();
  for (const file of modelFiles) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const classChunks = text.split(/\n(?=class\s+)/);
    for (const chunk of classChunks) {
      const tableMatch = chunk.match(/__tablename__\s*=\s*["']([^"']+)["']/);
      if (!tableMatch) continue;
      const tableName = tableMatch[1];
      if (seen.has(tableName)) continue;
      seen.add(tableName);
      entities.push({
        id: toEntityId(tableName),
        store_id: storeId,
        owner_component_id: ownerComponentId,
        classifications: classifyTable(tableName, chunk),
        constraints: extractConstraints(chunk),
        indexes: extractIndexes(chunk),
        migration_refs: [...new Set([...(tableToMigrations.get(tableName) ?? []), rel])].slice(0, 16),
        table_name: tableName,
        source_ref: rel
      });
    }
  }

  const priority = (entity) => {
    if (entity.table_name === "users") return 0;
    if (entity.table_name.includes("assessment")) return 1;
    if (entity.table_name.startsWith("kb_")) return 2;
    return 3;
  };
  entities.sort((left, right) => priority(left) - priority(right) || left.table_name.localeCompare(right.table_name));

  return {
    entities: entities.slice(0, MAX_ENTITIES).map(({ table_name, source_ref, ...entity }) => entity),
    migrationFiles: migrationFiles.map((file) => path.relative(root, file).replaceAll("\\", "/")),
    modelFiles: modelFiles.map((file) => path.relative(root, file).replaceAll("\\", "/")),
    rawEntities: entities.slice(0, MAX_ENTITIES)
  };
}


/**
 * Static role/permission scan from USER_ROLES and role gates in source.
 */
export function deriveRolesFromRepositoryRoot(root) {
  if (!root || !existsSync(root)) return { roles: [], authScheme: null, sources: [] };

  const roleSet = new Set();
  const permissionsByRole = new Map();
  const sources = [];
  let authScheme = null;

  const addPerm = (role, perm) => {
    const list = permissionsByRole.get(role) ?? new Set();
    list.add(perm);
    permissionsByRole.set(role, list);
  };

  const candidateDirs = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.isDirectory() && entry.name !== ".github") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name === "database") continue;
        if (["api", "services", "models", "middleware", "auth", "security"].includes(entry.name)) {
          candidateDirs.push(full);
        }
        queue.push(full);
      }
    }
  }

  const files = [];
  const seen = new Set();
  for (const dir of candidateDirs.length ? candidateDirs : [root]) {
    for (const file of walkFiles(dir, { maxFiles: 2500 })) {
      if (seen.has(file)) continue;
      seen.add(file);
      if (file.endsWith(".py") || file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js")) files.push(file);
    }
  }

  for (const file of files) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const rel = path.relative(root, file).replaceAll("\\", "/");

    if (/Authorization:\s*Bearer|Bearer\s+|jwt|JSONWebToken|create_access_token|HTTPBearer/i.test(text)) {
      authScheme = authScheme ?? "bearer-jwt";
    }

    for (const match of text.matchAll(/USER_ROLES\s*=\s*\(([^)]*)\)/g)) {
      sources.push(rel);
      for (const role of match[1].matchAll(/["']([A-Za-z][A-Za-z0-9_-]*)["']/g)) {
        roleSet.add(role[1]);
        addPerm(role[1], "identity:authenticated");
      }
    }

    for (const match of text.matchAll(/\brole\s*(?:==|!=)\s*["']([A-Za-z][A-Za-z0-9_-]*)["']/g)) {
      roleSet.add(match[1]);
    }
    for (const match of text.matchAll(/\brole\s+(?:not\s+)?in\s*\(([^)]*)\)/g)) {
      for (const role of match[1].matchAll(/["']([A-Za-z][A-Za-z0-9_-]*)["']/g)) roleSet.add(role[1]);
    }
    for (const match of text.matchAll(/\b(?:allowed_roles|ROLES)\s*=\s*\(([^)]*)\)/g)) {
      for (const role of match[1].matchAll(/["']([A-Za-z][A-Za-z0-9_-]*)["']/g)) roleSet.add(role[1]);
    }

    // Gate permissions from API/service modules
    const moduleSlug = rel
      .replace(/^backend\/src\//, "")
      .replace(/\.(py|ts|tsx|js)$/, "")
      .replaceAll("/", ".");
    if (/payload\.get\(\s*["']role["']\s*\)\s*!=\s*["']admin["']|role\s*!=\s*["']admin["']|Admin role required/i.test(text)) {
      roleSet.add("admin");
      addPerm("admin", `gate:${moduleSlug}`);
      sources.push(rel);
    }
    if (/payload\.get\(\s*["']role["']\s*\)\s*!=\s*["']teacher["']|role\s*!=\s*["']teacher["']|assert role == teacher/i.test(text)) {
      roleSet.add("teacher");
      addPerm("teacher", `gate:${moduleSlug}`);
      sources.push(rel);
    }
    if (/payload\.get\(\s*["']role["']\s*\)\s*!=\s*["']parent["']|role\s*!=\s*["']parent["']/i.test(text)) {
      roleSet.add("parent");
      addPerm("parent", `gate:${moduleSlug}`);
      sources.push(rel);
    }
    if (/payload\.get\(\s*["']role["']\s*\)\s*!=\s*["']schooladmin["']/i.test(text)) {
      roleSet.add("schooladmin");
      addPerm("schooladmin", `gate:${moduleSlug}`);
      sources.push(rel);
    }
    if (/role["']?\s+not\s+in\s*\{\s*["']overseer["']|role\s+not\s+in\s*\(.*overseer/i.test(text) || /["']overseer["']\s*,\s*["']admin["']/.test(text) && /role/.test(text)) {
      if (/overseer/.test(text) && /role/.test(text)) {
        roleSet.add("overseer");
        addPerm("overseer", `gate:${moduleSlug}`);
      }
    }
    if (/role not in \("teacher", "admin"\)|role not in \('teacher', 'admin'\)/.test(text)) {
      roleSet.add("teacher");
      roleSet.add("admin");
      addPerm("teacher", `gate:${moduleSlug}`);
      addPerm("admin", `gate:${moduleSlug}`);
      sources.push(rel);
    }
  }

  // Baseline permissions every discovered role gets
  for (const role of roleSet) {
    addPerm(role, `role:${role}`);
  }

  const preferred = ["student", "parent", "teacher", "overseer", "schooladmin", "admin"];
  const ordered = [
    ...preferred.filter((role) => roleSet.has(role)),
    ...[...roleSet].filter((role) => !preferred.includes(role)).sort()
  ];

  const roles = ordered.slice(0, 24).map((role) => ({
    id: `role-${role}`.slice(0, 128),
    permissions: [...(permissionsByRole.get(role) ?? new Set())].sort().slice(0, 32)
  }));

  return {
    roles,
    authScheme,
    sources: [...new Set(sources)].slice(0, 32)
  };
}

function detectHealthReadySource(root) {
  if (!root || !existsSync(root)) return null;
  const candidates = [
    "backend/src/main.py",
    "src/main.py",
    "app/main.py",
    "backend/main.py"
  ];
  for (const rel of candidates) {
    const absolute = path.join(root, rel);
    if (!existsSync(absolute)) continue;
    let text = "";
    try { text = readFileSync(absolute, "utf8"); } catch { continue; }
    if (/\/health\/ready/.test(text) && /database_readiness|readiness/.test(text)) return rel.replaceAll("\\", "/");
  }
  // fallback scan limited python mains
  for (const file of walkFiles(root, { maxFiles: 800 })) {
    const normalized = file.replaceAll("\\", "/");
    if (!normalized.endsWith("main.py")) continue;
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (/\/health\/ready/.test(text)) return path.relative(root, file).replaceAll("\\", "/");
  }
  return null;
}

function buildCriticalReadinessFlow({ components, entities, healthReadySource }) {
  const backend = components.find((item) => item.kind === "backend");
  const frontend = components.find((item) => item.kind === "frontend");
  const database = components.find((item) => item.kind === "database");
  if (!backend || !healthReadySource) return [];

  const userEntity = entities.find((entity) => entity.id === "entity-users") ?? entities[0];
  const kbEntity = entities.find((entity) => entity.id.includes("assessment") || entity.id.startsWith("entity-kb-")) ?? entities[1] ?? userEntity;
  if (!userEntity) return [];

  const reads = [...new Set([userEntity.id, kbEntity?.id].filter(Boolean))];
  const calls = ["store-primary"];
  if (database) calls.push(database.id);

  const steps = [];
  if (frontend) {
    steps.push({
      sequence: 1,
      component_id: frontend.id,
      action: "Probe GET /health/ready (or rely on platform checks)",
      reads: [],
      writes: [],
      calls: [backend.id],
      evidence_refs: [healthReadySource]
    });
  }
  steps.push({
    sequence: steps.length + 1,
    component_id: backend.id,
    action: "Run database_readiness and return ready/503",
    reads,
    writes: [],
    calls,
    evidence_refs: [healthReadySource]
  });

  return [{
    id: "flow-health-ready",
    trigger: "Operator or orchestrator probes GET /health/ready",
    outcome: "API reports ready only when configured databases respond; otherwise 503 with readiness detail",
    steps
  }];
}

/**
 * Build a schema-valid draft system-model from static detection + repo scan.
 */
export function buildDraftSystemModelFromOnboardingPlan(plan, { snapshot = null, repositoryRoot = null } = {}) {
  if (!plan?.repository_identity || !plan.commit_sha) {
    throw new Error("Draft system model requires a committed onboarding plan.");
  }

  const claims = plan.claims ?? [];
  const components = [];
  if (hasDomainSignal(claims, "frontend") || (snapshot?.detected?.platforms ?? []).includes("web")) {
    components.push({ id: "component-frontend", kind: "frontend", owner: "frontend" });
  }
  if (hasDomainSignal(claims, "backend") || (snapshot?.detected?.platforms ?? []).includes("api")) {
    components.push({ id: "component-backend", kind: "backend", owner: "backend" });
  }
  if (hasDomainSignal(claims, "database")) {
    components.push({ id: "component-database", kind: "database", owner: "database" });
  }
  if (components.length === 0) {
    components.push({ id: "component-repository", kind: "automation", owner: "repository" });
  }

  const stores = [];
  const storeKind = inferStoreKind(plan, snapshot);
  if (storeKind) {
    stores.push({
      id: "store-primary",
      kind: storeKind,
      disposable_test_available: false
    });
  }

  const root = repositoryRoot ?? repositoryRootFromSnapshot(snapshot);
  const frontend = components.find((item) => item.kind === "frontend");
  const backend = components.find((item) => item.kind === "backend");
  const roleDerived = deriveRolesFromRepositoryRoot(root);
  const roles = roleDerived.roles;
  const trust_boundaries = [];
  if (frontend && backend) {
    trust_boundaries.push({
      id: "boundary-frontend-backend",
      from_component_id: frontend.id,
      to_component_id: backend.id,
      authentication: roleDerived.authScheme ?? "unverified",
      authorization: roles.length > 0 ? "role-gated" : "unverified"
    });
  }

  const ownerComponentId = backend?.id ?? components[0].id;
  const derived = stores.length > 0
    ? deriveEntitiesFromRepositoryRoot(root, { storeId: "store-primary", ownerComponentId })
    : { entities: [], migrationFiles: [], modelFiles: [], rawEntities: [] };
  const entities = derived.entities;
  const healthReadySource = detectHealthReadySource(root);
  const flows = buildCriticalReadinessFlow({ components, entities, healthReadySource });

  const unknowns = [
    "Invariants and disposable-store proof are not yet established.",
    "Flow steps cite static source paths only; live evidence manifests are still required for ready."
  ];
  if (!stores.length) unknowns.unshift("No durable store was confidently classified from static signals.");
  if (!entities.length) unknowns.unshift("Entity inventory could not be derived from SQLAlchemy models or migrations.");
  else unknowns.push(`Entity inventory is static (${entities.length} tables); live schema/constraint proof is still missing.`);
  if (!flows.length) unknowns.push("No critical readiness flow was inferred from /health/ready.");
  else unknowns.push("Critical /health/ready flow is modeled from source, not yet runtime-observed.");
  if (!trust_boundaries.length) unknowns.push("No trust boundary could be inferred from detected components.");
  if (!roles.length) unknowns.push("Role and permission matrix could not be derived from USER_ROLES or role gates.");
  else unknowns.push(`Roles/permissions are static (${roles.length} roles from source gates); runtime authz proof is still missing.`);

  const risks = [];
  for (const claim of claims.filter((item) => item.status === "conflict").slice(0, 8)) {
    risks.push({
      id: `risk-${claim.id}`.slice(0, 128),
      classification: "goal-blocking",
      summary: claim.summary,
      evidence_refs: (claim.evidence_refs ?? []).slice(0, 8)
    });
  }
  for (const claim of claims.filter((item) => ["not-covered", "unverified"].includes(item.status) && ["database", "security"].includes(item.domain)).slice(0, 8)) {
    risks.push({
      id: `risk-gap-${claim.id}`.slice(0, 128),
      classification: "unverified",
      summary: claim.summary,
      evidence_refs: (claim.evidence_refs ?? []).slice(0, 8)
    });
  }

  const body = {
    schema_version: 1,
    repository_identity: plan.repository_identity,
    commit_sha: plan.commit_sha,
    components,
    stores,
    entities,
    trust_boundaries,
    roles,
    flows,
    invariants: [],
    risks,
    unknowns,
    verdict: "needs-evidence"
  };
  return {
    ...body,
    id: `system-model-draft-${hashContract(body).slice(0, 24)}`
  };
}

/**
 * Build a schema-valid proposed design-strategy (never approved here).
 */
export function buildProposedDesignStrategyFromOnboardingPlan(plan, { snapshot = null } = {}) {
  if (!plan?.repository_identity || !plan.commit_sha) {
    throw new Error("Proposed design strategy requires a committed onboarding plan.");
  }

  const platforms = snapshot?.detected?.platforms ?? [];
  const frameworks = snapshot?.detected?.frameworks ?? [];
  const stackNote = [...platforms, ...frameworks].slice(0, 6).join(", ") || "detected repository stack";

  const area = (principle) => ({
    principles: [principle],
    enforcement: ["human strategy review before approval", "alignment brief must surface drift"]
  });

  const draft = {
    schema_version: 1,
    repository_identity: plan.repository_identity,
    commit_sha: plan.commit_sha,
    strategy_version: 1,
    status: "proposed",
    frontend: area("Prefer reusable UI modules and explicit user-visible outcomes before styling churn."),
    backend: area("Keep API contracts, authorization, and failure paths explicit at module boundaries."),
    data: area("Treat schema, migrations, constraints, and disposable test data as first-class proof surfaces."),
    security: area("Model trust boundaries and roles before expanding privileged behavior."),
    testing: area("Climb the proof ladder: unit → service → browser/runtime evidence bound to the same revision."),
    decisions: [
      {
        id: "decision-proof-before-ready",
        rule: "Phase 1 understanding cannot become ready from static detection alone; live evidence and an approved strategy are required.",
        rationale: `Static signals only sketched ${stackNote}; claiming readiness would hide unverified database, security, and flow gaps.`,
        applies_to: ["**/*"],
        source_refs: ["onboarding-plan", "repository-understanding-baseline"],
        enforcement: "understanding-policy + human strategy gate"
      }
    ],
    exceptions: []
  };

  const withId = {
    ...draft,
    id: `design-strategy-draft-${hashContract(draft).slice(0, 24)}`
  };
  return {
    ...withId,
    artifact_sha256: strategyArtifactHash(withId)
  };
}

export async function createValidatedPhase1DraftsFromOnboardingPlan(plan, options = {}) {
  const systemModel = buildDraftSystemModelFromOnboardingPlan(plan, options);
  const strategy = buildProposedDesignStrategyFromOnboardingPlan(plan, options);
  await assertContract("system-model", systemModel);
  await assertContract("design-strategy", strategy);
  return { systemModel, strategy };
}
