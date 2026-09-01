import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WALK_EXCLUDES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "maplesparkvenv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache"
]);

const MANIFEST_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "Package.swift"
]);

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
  "go.sum",
  "Cargo.lock",
  "Gemfile.lock"
]);

const LANGUAGE_BY_EXTENSION = new Map([
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".py", "Python"],
  [".go", "Go"],
  [".rs", "Rust"],
  [".rb", "Ruby"],
  [".swift", "Swift"],
  [".kt", "Kotlin"],
  [".java", "Java"],
  [".cs", "C#"],
  [".php", "PHP"],
  [".sh", "Shell"]
]);

function runGit(root, args, options = {}) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
      input: options.input,
      maxBuffer: 16 * 1024 * 1024
    }).trimEnd();
  } catch {
    return null;
  }
}

function normalizeRelative(value) {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

async function walkFiles(root, { maxDepth = 12, onlyEnvironment = false } = {}) {
  const files = [];

  async function visit(directory, depth) {
    if (depth > maxDepth) {
      return;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && WALK_EXCLUDES.has(entry.name)) {
        continue;
      }

      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, depth + 1);
      } else if (entry.isFile()) {
        const relative = normalizeRelative(path.relative(root, absolute));
        if (!onlyEnvironment || isEnvironmentFile(relative)) {
          files.push(relative);
        }
      }
    }
  }

  await visit(root, 0);
  return files.sort();
}

async function repositoryFiles(root, isGitRepository) {
  if (isGitRepository) {
    const output = runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    if (output !== null) {
      return output.split("\0").filter(Boolean).map(normalizeRelative).sort();
    }
  }
  return walkFiles(root);
}

function isEnvironmentFile(relative) {
  const name = path.posix.basename(relative);
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name.endsWith(".env") ||
    name.endsWith(".env.example") ||
    name.endsWith(".env.sample")
  );
}

function isExampleEnvironmentFile(relative) {
  const name = path.posix.basename(relative).toLowerCase();
  return name.includes("example") || name.includes("sample") || name.includes("template");
}

async function readLimited(file, limit = 1024 * 1024) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > limit) {
      return "";
    }
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

function envKeyStates(content) {
  const declared = [];
  const set = [];
  const placeholder = /(change.?me|your[_-]|example|placeholder|xxx|todo)/i;

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    declared.push(match[1]);
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    if (value.length > 0 && !placeholder.test(value)) {
      set.push(match[1]);
    }
  }

  return { declared, set };
}

function remoteParts(remote) {
  if (!remote) {
    return null;
  }

  const sshMatch = remote.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (sshMatch && !remote.includes("://")) {
    return {
      host: sshMatch[1].toLowerCase(),
      identity: `${sshMatch[1].toLowerCase()}/${sshMatch[2].replace(/\.git$/, "")}`
    };
  }

  try {
    const parsed = new URL(remote);
    return {
      host: parsed.hostname.toLowerCase(),
      identity: `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\.git$/, "")}`
    };
  } catch {
    return null;
  }
}

function dependencyNames(packageJson) {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {})
  ]);
}

function packageManager(lockfiles) {
  if (lockfiles.some((file) => path.posix.basename(file) === "pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.some((file) => path.posix.basename(file) === "yarn.lock")) return "yarn";
  if (lockfiles.some((file) => ["bun.lock", "bun.lockb"].includes(path.posix.basename(file)))) return "bun";
  return "npm";
}

function packageScriptCommand(manager, directory, script) {
  const location = directory === "." ? null : directory;
  if (manager === "pnpm") return location ? `pnpm --dir ${location} run ${script}` : `pnpm run ${script}`;
  if (manager === "yarn") return location ? `yarn --cwd ${location} ${script}` : `yarn ${script}`;
  if (manager === "bun") return location ? `bun --cwd ${location} run ${script}` : `bun run ${script}`;
  return location ? `npm --prefix ${location} run ${script}` : `npm run ${script}`;
}

function commandKind(script) {
  if (/^build(?::|$)/.test(script)) return "build";
  if (/^test(?::|$)/.test(script)) return "test";
  if (/^(lint|format:check)(?::|$)/.test(script)) return "lint";
  if (/^(typecheck|type-check|check)(?::|$)/.test(script)) return "typecheck";
  if (/^(dev|start|serve)(?::|$)/.test(script)) return "launch";
  if (/^(verify|qa|e2e)(?::|$)/.test(script)) return "verify";
  return null;
}

function commandId(directory, script) {
  const prefix = directory === "." ? "root" : directory.replace(/[^A-Za-z0-9]+/g, "-");
  return `${prefix}-${script.replace(/[^A-Za-z0-9]+/g, "-")}`.replace(/-+$/g, "");
}

async function inspectPackages(root, manifestFiles, lockfiles) {
  const packages = [];
  const manager = packageManager(lockfiles);

  for (const relative of manifestFiles.filter((file) => path.posix.basename(file) === "package.json")) {
    try {
      const parsed = JSON.parse(await readLimited(path.join(root, relative)));
      const directory = normalizeRelative(path.posix.dirname(relative));
      packages.push({
        relative,
        directory: directory === "" ? "." : directory,
        dependencies: dependencyNames(parsed),
        scripts: parsed.scripts ?? {},
        bin: parsed.bin ?? null
      });
    } catch {
      // A malformed manifest is surfaced later as missing reproducible commands.
    }
  }

  const commands = [];
  for (const pkg of packages) {
    for (const script of Object.keys(pkg.scripts).sort()) {
      const kind = commandKind(script);
      if (!kind) continue;
      commands.push({
        id: commandId(pkg.directory, script),
        kind,
        run: packageScriptCommand(manager, pkg.directory, script),
        source: pkg.relative
      });
    }
  }

  return { packages, commands };
}

function uniqueCommands(commands) {
  const counts = new Map();
  return commands.map((command) => {
    const next = (counts.get(command.id) ?? 0) + 1;
    counts.set(command.id, next);
    return next === 1 ? command : { ...command, id: `${command.id}-${next}` };
  });
}

async function pythonCorpus(root, manifests) {
  const contents = await Promise.all(
    manifests
      .filter((file) => /(^|\/)(pyproject\.toml|requirements[^/]*\.txt)$/.test(file))
      .map((file) => readLimited(path.join(root, file)))
  );
  return contents.join("\n").toLowerCase();
}

function detectSubmodules(root, isGitRepository) {
  if (!isGitRepository) return [];
  const output = runGit(root, ["submodule", "status", "--recursive"]);
  if (!output) return [];

  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const prefix = line[0];
    const match = line.slice(1).trim().match(/^([0-9a-f]{40,64})\s+(\S+)/);
    const status =
      prefix === "-" ? "missing" : prefix === "+" ? "modified" : prefix === "U" ? "conflicted" : prefix === " " ? "initialized" : "unknown";
    return {
      path: match?.[2] ?? line.slice(1).trim(),
      status,
      ...(match?.[1] ? { commit_sha: match[1] } : {})
    };
  });
}

export async function discoverRepository(requestedRoot) {
  const requested = path.resolve(requestedRoot);
  const gitTop = runGit(requested, ["rev-parse", "--show-toplevel"]);
  const isGitRepository = gitTop !== null;
  const root = isGitRepository ? path.resolve(gitTop) : requested;
  const files = await repositoryFiles(root, isGitRepository);
  const fileSet = new Set(files);
  const manifests = files.filter((file) => MANIFEST_NAMES.has(path.posix.basename(file))).sort();
  const lockfiles = files.filter((file) => LOCKFILE_NAMES.has(path.posix.basename(file))).sort();
  const { packages, commands: packageCommands } = await inspectPackages(root, manifests, lockfiles);
  const pythonText = await pythonCorpus(root, manifests);

  const frameworks = new Set();
  const dependencySet = new Set(packages.flatMap((pkg) => [...pkg.dependencies]));
  const dependencyFrameworks = new Map([
    ["next", "Next.js"],
    ["react", "React"],
    ["vue", "Vue"],
    ["vite", "Vite"],
    ["express", "Express"],
    ["@nestjs/core", "NestJS"],
    ["electron", "Electron"],
    ["@prisma/client", "Prisma"],
    ["prisma", "Prisma"],
    ["typeorm", "TypeORM"],
    ["sequelize", "Sequelize"],
    ["drizzle-orm", "Drizzle"]
  ]);
  for (const [dependency, framework] of dependencyFrameworks) {
    if (dependencySet.has(dependency)) frameworks.add(framework);
  }
  if (/\bfastapi\b/.test(pythonText)) frameworks.add("FastAPI");
  if (/\bdjango\b/.test(pythonText)) frameworks.add("Django");
  if (/\bflask\b/.test(pythonText)) frameworks.add("Flask");
  if (/\bsqlalchemy\b/.test(pythonText)) frameworks.add("SQLAlchemy");

  const languages = new Set();
  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION.get(path.posix.extname(file));
    if (language) languages.add(language);
  }

  const testTools = new Set();
  if (files.some((file) => /(^|\/)playwright\.config\.(js|ts|mjs|cjs)$/.test(file)) || dependencySet.has("@playwright/test")) testTools.add("Playwright");
  if (files.some((file) => /(^|\/)vitest\.config\./.test(file)) || dependencySet.has("vitest")) testTools.add("Vitest");
  if (files.some((file) => /(^|\/)jest\.config\./.test(file)) || dependencySet.has("jest")) testTools.add("Jest");
  if (files.some((file) => /(^|\/)(pytest\.ini|conftest\.py)$/.test(file)) || /\bpytest\b/.test(pythonText) || files.some((file) => /(^|\/)test_[^/]+\.py$/.test(file))) testTools.add("pytest");
  if (files.some((file) => /(^|\/)tests?\/.*\.(go|rs)$/.test(file))) testTools.add("native-tests");

  const composeFiles = files.filter((file) => /(^|\/)(docker-)?compose[^/]*\.(yml|yaml)$/.test(file));
  const composeText = (await Promise.all(composeFiles.map((file) => readLimited(path.join(root, file))))).join("\n").toLowerCase();
  const services = new Set();
  if (/postgres/.test(composeText)) services.add("PostgreSQL");
  if (/redis/.test(composeText)) services.add("Redis");
  if (/mysql|mariadb/.test(composeText)) services.add("MySQL");
  if (/mongo/.test(composeText)) services.add("MongoDB");
  if (/kafka/.test(composeText)) services.add("Kafka");
  if (["pg", "postgres", "@prisma/client"].some((dependency) => dependencySet.has(dependency))) services.add("PostgreSQL");
  if (["mysql", "mysql2"].some((dependency) => dependencySet.has(dependency))) services.add("MySQL");
  if (["mongodb", "mongoose"].some((dependency) => dependencySet.has(dependency))) services.add("MongoDB");
  if (["redis", "ioredis"].some((dependency) => dependencySet.has(dependency))) services.add("Redis");
  if (composeFiles.length > 0) services.add("Docker Compose");

  const platforms = new Set();
  if (["Next.js", "React", "Vue", "Vite"].some((name) => frameworks.has(name))) platforms.add("web");
  if (["FastAPI", "Django", "Flask", "Express", "NestJS"].some((name) => frameworks.has(name))) platforms.add("api");
  if (frameworks.has("Next.js") && (files.some((file) => /(^|\/)(app\/api|pages\/api)\//.test(file)) || ["Prisma", "TypeORM", "Sequelize", "Drizzle"].some((name) => frameworks.has(name)))) platforms.add("api");
  if (packages.some((pkg) => pkg.bin) || /\b(typer|click)\b/.test(pythonText)) platforms.add("cli");
  if (frameworks.has("Electron")) platforms.add("desktop");
  if (files.some((file) => file.endsWith(".xcodeproj/project.pbxproj"))) platforms.add("mobile");
  if (platforms.size === 0 && manifests.length > 0) platforms.add("library");
  if (platforms.size === 0) platforms.add("unknown");

  const packageManagers = new Set();
  for (const lockfile of lockfiles) {
    const name = path.posix.basename(lockfile);
    if (name === "package-lock.json") packageManagers.add("npm");
    if (name === "pnpm-lock.yaml") packageManagers.add("pnpm");
    if (name === "yarn.lock") packageManagers.add("yarn");
    if (name === "bun.lock" || name === "bun.lockb") packageManagers.add("bun");
    if (name === "uv.lock") packageManagers.add("uv");
    if (name === "poetry.lock") packageManagers.add("poetry");
    if (name === "Cargo.lock") packageManagers.add("cargo");
    if (name === "go.sum") packageManagers.add("go");
  }

  const commands = [...packageCommands];
  if (testTools.has("pytest") && !commands.some((command) => command.run.includes("pytest"))) {
    commands.push({ id: "python-tests", kind: "test", run: "python -m pytest", source: "detected:pytest" });
  }
  if (testTools.has("Playwright") && !commands.some((command) => command.kind === "verify" && command.run.includes("playwright"))) {
    commands.push({ id: "web-playwright", kind: "verify", run: "npx playwright test", source: "detected:playwright" });
  }
  const safeComposeFiles = composeFiles.filter((file) => !/(^|[._-])(prod|production)([._-]|$)/i.test(path.posix.basename(file)));
  if (safeComposeFiles.length > 0) {
    commands.push({ id: "docker-compose-launch", kind: "launch", run: "docker compose up --build", source: safeComposeFiles[0] });
    commands.push({ id: "docker-compose-build", kind: "build", run: "docker compose build", source: safeComposeFiles[0] });
  }

  const environmentCandidates = [...new Set([...(await walkFiles(root, { maxDepth: 4, onlyEnvironment: true })), ...files.filter(isEnvironmentFile)])].sort();
  const exampleFiles = environmentCandidates.filter(isExampleEnvironmentFile);
  const localFiles = environmentCandidates.filter((file) => !isExampleEnvironmentFile(file));
  const declaredKeys = new Set();
  const locallySetKeys = new Set();
  for (const relative of exampleFiles) {
    const state = envKeyStates(await readLimited(path.join(root, relative)));
    state.declared.forEach((key) => declaredKeys.add(key));
  }
  for (const relative of localFiles) {
    const state = envKeyStates(await readLimited(path.join(root, relative)));
    state.set.forEach((key) => locallySetKeys.add(key));
  }
  const localFilesIgnored = localFiles.every((relative) => runGit(root, ["check-ignore", "-q", "--", relative]) !== null);

  const origin = runGit(root, ["remote", "get-url", "origin"]);
  const originParts = remoteParts(origin);
  const remoteHosts = originParts ? [originParts.host] : [];
  const fallbackIdentity = path.basename(root).replace(/[^A-Za-z0-9._-]+/g, "-");
  const statusOutput = isGitRepository ? runGit(root, ["status", "--porcelain=v1"]) ?? "" : "";
  const changedFileCount = statusOutput === "" ? 0 : statusOutput.split(/\r?\n/).filter(Boolean).length;

  const ciFiles = files.filter((file) =>
    file.startsWith(".github/workflows/") ||
    file === ".gitlab-ci.yml" ||
    file === "azure-pipelines.yml" ||
    file === "Jenkinsfile"
  );
  const deploymentFiles = files.filter((file) =>
    /(^|\/)Dockerfile(?:\.[^/]*)?$/.test(file) ||
    /(^|\/)(docker-)?compose[^/]*\.(yml|yaml)$/.test(file) ||
    file.startsWith("deployments/") ||
    file.startsWith(".kubernetes/") ||
    file.startsWith("k8s/") ||
    file.startsWith("terraform/") ||
    /(^|\/)(deploy|release|rollback)[^/]*\.(sh|js|mjs|py)$/.test(file)
  );
  const agentFiles = files.filter((file) =>
    file === "AGENTS.md" ||
    file === "CLAUDE.md" ||
    file === "devharness.yaml" ||
    file === "devharness.yml" ||
    file.startsWith(".agents/") ||
    file.startsWith(".cursor/") ||
    file.startsWith(".claude/")
  );

  return {
    schema_version: 1,
    captured_at: new Date().toISOString(),
    repository: {
      name: path.basename(root),
      root_uri: pathToFileURL(root).href,
      identity: originParts?.identity ?? fallbackIdentity,
      git: {
        is_repository: isGitRepository,
        ...(isGitRepository && runGit(root, ["rev-parse", "HEAD"]) ? { head_sha: runGit(root, ["rev-parse", "HEAD"]) } : {}),
        ...(isGitRepository ? { branch: runGit(root, ["branch", "--show-current"]) ?? "" } : {}),
        dirty: changedFileCount > 0,
        changed_file_count: changedFileCount,
        remote_hosts: remoteHosts
      }
    },
    inventory: {
      file_count: files.length,
      manifests,
      lockfiles
    },
    detected: {
      platforms: [...platforms].sort(),
      languages: [...languages].sort(),
      frameworks: [...frameworks].sort(),
      package_managers: [...packageManagers].sort(),
      services: [...services].sort(),
      test_tools: [...testTools].sort(),
      ci_files: ciFiles.sort(),
      deployment_files: deploymentFiles.sort(),
      agent_files: agentFiles.sort()
    },
    commands: uniqueCommands(commands).sort((a, b) => a.id.localeCompare(b.id)),
    environment: {
      example_files: exampleFiles,
      local_files: localFiles,
      declared_keys: [...declaredKeys].sort(),
      locally_set_keys: [...locallySetKeys].sort(),
      local_files_ignored: localFilesIgnored
    },
    submodules: detectSubmodules(root, isGitRepository)
  };
}
