import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { hashContract } from "../../project/src/harness.mjs";
import { normalizeExactHttpsOrigin, normalizeExactHttpsUrl, ResearchPolicyError } from "./research-policy.mjs";

function asRecipeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.recipes)) return raw.recipes;
  throw new ResearchPolicyError("INVALID_RECIPE_FILE", "Research recipe file must be an array or { recipes: [...] }.");
}

function normalizeRecipe(entry, index) {
  if (!entry || typeof entry !== "object") {
    throw new ResearchPolicyError("INVALID_RECIPE", `Research recipe ${index + 1} must be an object.`);
  }
  const taskId = entry.taskId ?? entry.task_id ?? entry.queryId ?? entry.query_id;
  if (typeof taskId !== "string" || taskId.length < 1 || taskId.length > 128) {
    throw new ResearchPolicyError("INVALID_RECIPE", `Research recipe ${index + 1} requires taskId.`);
  }
  const origin = normalizeExactHttpsOrigin(entry.origin);
  const url = normalizeExactHttpsUrl(entry.url, [origin]);
  const originId = entry.originId ?? entry.origin_id ?? `origin-${taskId}`;
  return {
    taskId,
    queryId: entry.queryId ?? entry.query_id ?? taskId,
    origin,
    url,
    originId,
    recipeId: entry.recipeId ?? entry.recipe_id ?? `request-${taskId}`,
    originSource: entry.originSource ?? entry.origin_source ?? "developer-input",
    originSourceSha256: entry.originSourceSha256 ?? entry.origin_source_sha256 ?? hashContract({
      taskId,
      origin,
      url,
      source: "research-recipes"
    }),
    query: entry.query,
    deadlineSeconds: entry.deadlineSeconds ?? entry.deadline_seconds,
    maxResponseBytes: entry.maxResponseBytes ?? entry.max_response_bytes,
    notes: entry.notes ?? null
  };
}

export function parseResearchRecipesDocument(raw, { sourceLabel = "research recipes" } = {}) {
  let document = raw;
  if (typeof raw === "string") {
    try {
      document = JSON.parse(raw);
    } catch {
      throw new ResearchPolicyError("INVALID_RECIPE_FILE", `${sourceLabel} is not valid JSON.`);
    }
  }
  const recipes = asRecipeList(document).map((entry, index) => normalizeRecipe(entry, index));
  const seen = new Set();
  for (const recipe of recipes) {
    if (seen.has(recipe.taskId)) {
      throw new ResearchPolicyError("INVALID_RECIPE_FILE", `Duplicate research recipe for task ${recipe.taskId}.`);
    }
    seen.add(recipe.taskId);
  }
  return recipes;
}

export async function loadResearchRecipesFile(filePath) {
  if (typeof filePath !== "string" || filePath.length < 1) {
    throw new ResearchPolicyError("INVALID_RECIPE_FILE", "Research recipe path is required.");
  }
  const absolute = path.resolve(filePath);
  const raw = await readFile(absolute, "utf8");
  return parseResearchRecipesDocument(raw, { sourceLabel: absolute });
}

export async function resolveResearchRecipesPath({ explicitPath = null, configPath = null } = {}) {
  if (explicitPath) return path.resolve(explicitPath);
  if (!configPath) return null;
  const candidate = path.join(path.dirname(path.resolve(configPath)), "research-recipes.json");
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function loadResearchRecipesForContinue({ researchRecipesPath = null, configPath = null } = {}) {
  const resolved = await resolveResearchRecipesPath({
    explicitPath: researchRecipesPath,
    configPath
  });
  if (!resolved) return [];
  return loadResearchRecipesFile(resolved);
}

export { ResearchPolicyError };
