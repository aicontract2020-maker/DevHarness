import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertContract } from "../../project/src/contracts.mjs";

export async function readJsonIfExists(targetPath) {
  try {
    return JSON.parse(await readFile(targetPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function defaultDataRoot(environment = process.env) {
  if (environment.DEVHARNESS_DATA_DIR) return path.resolve(environment.DEVHARNESS_DATA_DIR);
  if (environment.XDG_STATE_HOME) return path.join(path.resolve(environment.XDG_STATE_HOME), "devharness");
  return path.join(os.homedir(), ".local", "state", "devharness");
}

// Trusted Supervisor state defaults to a fixed user-level anchor, but can be overridden
// explicitly for local development with DEVHARNESS_SUPERVISOR_DIR.
export function defaultSupervisorRoot(environment = process.env) {
  if (environment.DEVHARNESS_SUPERVISOR_DIR) return path.resolve(environment.DEVHARNESS_SUPERVISOR_DIR);
  return path.join(os.homedir(), ".local", "state", "devharness-supervisor");
}

export function repositoryStorageKey(identity) {
  return createHash("sha256").update(identity).digest("hex");
}

export function projectDataDirectory(dataRoot, identity) {
  return path.join(dataRoot, "projects", repositoryStorageKey(identity));
}

export function verificationPaths(dataRoot, identity, verificationId) {
  const projectRoot = projectDataDirectory(dataRoot, identity);
  const runRoot = path.join(projectRoot, "verification", verificationId);
  return {
    projectRoot,
    runRoot,
    workspace: path.join(runRoot, "workspace"),
    artifacts: path.join(runRoot, "artifacts"),
    stdout: path.join(runRoot, "artifacts", "stdout.log"),
    stderr: path.join(runRoot, "artifacts", "stderr.log"),
    serviceArtifacts: path.join(runRoot, "artifacts", "services"),
    receipt: path.join(projectRoot, "receipts", `${verificationId}.json`)
  };
}

export function projectHarnessPath(dataRoot, identity, harnessId) {
  return path.join(projectDataDirectory(dataRoot, identity), "harnesses", `${harnessId}.json`);
}

export function understandingBaselinePath(dataRoot, identity, baselineId) {
  return path.join(projectDataDirectory(dataRoot, identity), "understanding", `${baselineId}.json`);
}

export function systemModelPath(dataRoot, identity, modelId) {
  return path.join(projectDataDirectory(dataRoot, identity), "system-models", `${modelId}.json`);
}

export function designStrategyPath(dataRoot, identity, strategyId) {
  return path.join(projectDataDirectory(dataRoot, identity), "strategies", `${strategyId}.json`);
}

export function onboardingPlanPath(dataRoot, identity, planId) {
  return path.join(projectDataDirectory(dataRoot, identity), "onboarding", `${planId}.json`);
}

export async function prepareVerificationStorage(paths) {
  await mkdir(paths.artifacts, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(paths.receipt), { recursive: true, mode: 0o700 });
}

export async function writeReceipt(receiptPath, receipt) {
  await assertContract("verification-receipt", receipt);
  const temporary = `${receiptPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, receiptPath);
}

export async function writeProjectHarness(harnessPath, manifest) {
  await assertContract("project-harness", manifest);
  await mkdir(path.dirname(harnessPath), { recursive: true, mode: 0o700 });
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    const existing = await readFile(harnessPath, "utf8");
    if (existing === content) return { path: harnessPath, written: false };
    throw new Error(`A different project harness already exists at ${harnessPath}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${harnessPath}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, harnessPath);
  return { path: harnessPath, written: true };
}

export async function writeUnderstandingBaseline(baselinePath, baseline) {
  await assertContract("repository-understanding-baseline", baseline);
  await mkdir(path.dirname(baselinePath), { recursive: true, mode: 0o700 });
  const temporary = `${baselinePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(baseline, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, baselinePath);
  return { path: baselinePath, written: true };
}

export async function writeSystemModel(modelPath, model) {
  await assertContract("system-model", model);
  await mkdir(path.dirname(modelPath), { recursive: true, mode: 0o700 });
  const temporary = `${modelPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(model, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, modelPath);
  return { path: modelPath, written: true };
}

export async function writeDesignStrategy(strategyPath, strategy) {
  await assertContract("design-strategy", strategy);
  await mkdir(path.dirname(strategyPath), { recursive: true, mode: 0o700 });
  const temporary = `${strategyPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(strategy, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, strategyPath);
  return { path: strategyPath, written: true };
}


export async function overwriteDesignStrategy(strategyPath, strategy) {
  await assertContract("design-strategy", strategy);
  await mkdir(path.dirname(strategyPath), { recursive: true, mode: 0o700 });
  const temporary = `${strategyPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(strategy, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, strategyPath);
  return { path: strategyPath, written: true };
}

export async function overwriteUnderstandingBaseline(baselinePath, baseline) {
  await assertContract("repository-understanding-baseline", baseline);
  await mkdir(path.dirname(baselinePath), { recursive: true, mode: 0o700 });
  const temporary = `${baselinePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(baseline, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, baselinePath);
  return { path: baselinePath, written: true };
}

export async function writeOnboardingPlan(planPath, plan) {
  await assertContract("onboarding-plan", plan);
  await mkdir(path.dirname(planPath), { recursive: true, mode: 0o700 });
  const temporary = `${planPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, planPath);
  return { path: planPath, written: true };
}

async function sha256File(file) {
  const content = await readFile(file);
  return createHash("sha256").update(content).digest("hex");
}

async function artifactsAreIntact(receipt) {
  for (const artifact of receipt.artifacts) {
    if (!artifact.uri.startsWith("file://")) return false;
    let file;
    try {
      file = fileURLToPath(artifact.uri);
      const info = await stat(file);
      if (!info.isFile() || info.size !== artifact.size_bytes) return false;
      if ((await sha256File(file)) !== artifact.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function listValidReceipts(dataRoot, identity) {
  const receiptDirectory = path.join(projectDataDirectory(dataRoot, identity), "receipts");
  let names;
  try {
    names = await readdir(receiptDirectory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const receipts = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".json")).sort()) {
    try {
      const receipt = JSON.parse(await readFile(path.join(receiptDirectory, name), "utf8"));
      await assertContract("verification-receipt", receipt);
      if (await artifactsAreIntact(receipt)) receipts.push(receipt);
    } catch {
      // Corrupt, stale, or tampered receipts are ignored rather than trusted.
    }
  }
  return receipts;
}
