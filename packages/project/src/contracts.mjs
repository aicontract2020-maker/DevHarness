import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SchemaRegistry } from "../../schema/src/validator.mjs";

let registryPromise;

export function loadContractRegistry() {
  if (!registryPromise) {
    registryPromise = (async () => {
      const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
      const schemaDirectory = path.resolve(sourceDirectory, "../../schema/schemas/v1");
      const schemas = await Promise.all(
        (await readdir(schemaDirectory))
          .filter((name) => name.endsWith(".schema.json"))
          .map(async (name) => JSON.parse(await readFile(path.join(schemaDirectory, name), "utf8")))
      );
      return new SchemaRegistry(schemas);
    })();
  }
  return registryPromise;
}

export async function assertContract(schemaName, value) {
  const registry = await loadContractRegistry();
  const result = registry.validate(`https://devharness.dev/schemas/v1/${schemaName}.schema.json`, value);
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.path} ${error.message}`).join("; ");
    throw new Error(`${schemaName} contract violation: ${details}`);
  }
  return value;
}

