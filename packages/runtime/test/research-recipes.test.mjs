import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadResearchRecipesFile,
  parseResearchRecipesDocument,
  resolveResearchRecipesPath,
  loadResearchRecipesForContinue
} from "../src/research-recipes.mjs";

test("parseResearchRecipesDocument accepts exact HTTPS recipes", () => {
  const recipes = parseResearchRecipesDocument({
    recipes: [{
      taskId: "research-task-1",
      origin: "https://www.postgresql.org",
      url: "https://www.postgresql.org/docs/current/ddl.html"
    }]
  });
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].taskId, "research-task-1");
  assert.equal(recipes[0].origin, "https://www.postgresql.org");
  assert.match(recipes[0].originSourceSha256, /^[0-9a-f]{64}$/);
});

test("parseResearchRecipesDocument rejects non-HTTPS and localhost", () => {
  assert.throws(
    () => parseResearchRecipesDocument([{ taskId: "research-task-1", origin: "http://example.com", url: "http://example.com/a" }]),
    /HTTPS/
  );
  assert.throws(
    () => parseResearchRecipesDocument([{ taskId: "research-task-1", origin: "https://localhost", url: "https://localhost/a" }]),
    /localhost|local domain|IP/
  );
});

test("resolveResearchRecipesPath prefers explicit path then config sibling", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-recipes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "devharness.yaml");
  const sibling = path.join(root, "research-recipes.json");
  await writeFile(configPath, "version: 1\n");
  await writeFile(sibling, JSON.stringify([{
    taskId: "research-task-1",
    origin: "https://playwright.dev",
    url: "https://playwright.dev/docs/best-practices"
  }]));
  assert.equal(await resolveResearchRecipesPath({ configPath }), sibling);
  const explicit = path.join(root, "custom.json");
  await writeFile(explicit, "[]");
  assert.equal(await resolveResearchRecipesPath({ explicitPath: explicit, configPath }), explicit);
  const loaded = await loadResearchRecipesForContinue({ configPath });
  assert.equal(loaded[0].taskId, "research-task-1");
  const fromFile = await loadResearchRecipesFile(sibling);
  assert.equal(fromFile[0].url, "https://playwright.dev/docs/best-practices");
});
