import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function canonicalPath(value) {
  const resolved = path.resolve(value);
  let existing = resolved;
  const suffix = [];

  while (true) {
    try {
      return path.join(realpathSync.native(existing), ...suffix.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      suffix.push(path.basename(existing));
      existing = parent;
    }
  }
}

export function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveExternalDataRoot(repositoryRootUri, dataRoot) {
  const repositoryRoot = canonicalPath(fileURLToPath(repositoryRootUri));
  const resolvedDataRoot = canonicalPath(dataRoot);
  if (isWithin(repositoryRoot, resolvedDataRoot)) {
    throw new Error("DevHarness runtime data must be stored outside the consumer repository.");
  }
  return { repositoryRoot, dataRoot: resolvedDataRoot };
}

