import { readdirSync, readFileSync } from "node:fs";
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

const PLAYWRIGHT_CONFIG_PATTERN = /^playwright\.config\.(?:js|mjs|cjs|ts)$/i;
const LOOPBACK_URL_PATTERN = /http:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/[^\s'"`)]*)?/i;
const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function collectPlaywrightConfigs(root) {
  const found = [];

  function visit(directory, depth) {
    if (depth > 6) return;

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, depth + 1);
      } else if (entry.isFile() && PLAYWRIGHT_CONFIG_PATTERN.test(entry.name)) {
        found.push(absolute);
      }
    }
  }

  visit(root, 0);
  return found.sort();
}

function detectPlaywrightBaseUrls(root) {
  const baseUrls = new Map();
  for (const absolute of collectPlaywrightConfigs(root)) {
    const content = readText(absolute);
    const match = content.match(LOOPBACK_URL_PATTERN);
    if (!match) continue;
    try {
      const url = new URL(match[0]);
      if (url.protocol !== "http:") continue;
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !/^127(?:\.\d{1,3}){3}$/.test(url.hostname)) continue;
      const relativeDir = path.relative(root, path.dirname(absolute));
      baseUrls.set((relativeDir === "" ? "." : relativeDir).split(path.sep).join("/"), url.origin);
    } catch {
      // Ignore malformed candidates and keep scanning.
    }
  }
  return baseUrls;
}

export function proposeProjectConfig(snapshot) {
  const platforms = snapshot.detected.platforms.filter((platform) => platform !== "unknown");
  const root = fileURLToPath(snapshot.repository.root_uri);
  const browserBaseUrls = detectPlaywrightBaseUrls(root);
  const launchCommands = snapshot.commands.filter((command) => command.kind === "launch");
  const services = [];
  const uniqueBaseUrls = new Set(browserBaseUrls.values());
  const defaultBaseUrl = uniqueBaseUrls.size === 1 ? [...uniqueBaseUrls][0] : null;
  for (const command of launchCommands) {
    const commandDirectory = path.posix.dirname(command.source);
    const readinessUrl = browserBaseUrls.get(commandDirectory) ?? defaultBaseUrl;
    if (!readinessUrl) continue;
    services.push({
      id: `${command.id}-service`,
      command_id: command.id,
      readiness: {
        kind: "http",
        url: readinessUrl,
        expected_statuses: [200],
        timeout_ms: 60_000,
        interval_ms: 1_000
      },
      shutdown: {
        grace_ms: 1_000
      }
    });
  }
  const verificationServiceIds = services.length > 0 && uniqueBaseUrls.size === 1 ? [services[0].id] : [];
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
      services,
      verifications: snapshot.commands
        .filter((command) => command.kind === "verify")
        .map((command) => ({ command_id: command.id, service_ids: verificationServiceIds, warmup: [] }))
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
