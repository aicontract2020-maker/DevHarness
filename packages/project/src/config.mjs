import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { assertContract } from "./contracts.mjs";

export async function readProjectConfigFile(requestedPath) {
  let configPath;
  try {
    configPath = await realpath(path.resolve(requestedPath));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Project configuration does not exist: ${path.resolve(requestedPath)}`);
    throw error;
  }
  let content;
  try {
    content = await readFile(configPath, "utf8");
  } catch (error) {
    throw error;
  }

  let config;
  try {
    config = JSON.parse(content);
  } catch {
    throw new Error("v0 requires project configuration to use canonical JSON-compatible YAML.");
  }

  await assertContract("project-config", config);
  return { config, path: configPath };
}

export async function readProjectConfig(root) {
  const candidates = ["devharness.yaml", "devharness.yml"];
  let content;
  let configPath;

  for (const candidate of candidates) {
    try {
      configPath = path.join(root, candidate);
      content = await readFile(configPath, "utf8");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  if (content === undefined) {
    throw new Error("No devharness.yaml exists. Run `devharness init`, review it, then use --write.");
  }

  return readProjectConfigFile(configPath);
}
