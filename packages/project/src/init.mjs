import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function identifier(value) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return /^[A-Za-z]/.test(normalized) ? normalized : `project-${normalized || "unknown"}`;
}

export function proposeProjectConfig(snapshot) {
  const platforms = snapshot.detected.platforms.filter((platform) => platform !== "unknown");
  return {
    version: 1,
    project: {
      id: identifier(snapshot.repository.name)
    },
    platforms: platforms.length > 0 ? platforms : ["unknown"],
    quality: {
      commands: snapshot.commands
    },
    harness: {
      services: [],
      verifications: snapshot.commands
        .filter((command) => command.kind === "verify")
        .map((command) => ({ command_id: command.id, service_ids: [], warmup: [] }))
    },
    autonomy: {
      required_gates: ["scope", "delivery"]
    },
    delivery: {
      provider: snapshot.repository.git.remote_hosts.includes("github.com") ? "github" : "manual",
      target: "pull-request"
    }
  };
}

export function formatProjectConfig(config) {
  // JSON is a strict subset of YAML 1.2. Keeping the v0 representation canonical
  // gives us dependency-free parsing without accepting YAML tags, anchors, or code.
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function initializeProject(snapshot, { write = false } = {}) {
  const config = proposeProjectConfig(snapshot);
  const content = formatProjectConfig(config);
  const root = fileURLToPath(snapshot.repository.root_uri);
  const configPath = path.join(root, "devharness.yaml");

  if (write) {
    await writeFile(configPath, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
  }

  return { config, content, path: configPath, written: write };
}
