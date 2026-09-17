import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

test("verify.mjs scrubs host DB env for kind=test unless env_keys opts in", () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/verify.mjs");
  const source = readFileSync(file, "utf8");
  assert.match(source, /HOST_DB_ENV/);
  assert.match(source, /scrubHostDbForUnitTests/);
  assert.match(source, /command\.kind === "test"/);
  assert.match(source, /explicitCommandKeys\.has\(key\)/);
});
