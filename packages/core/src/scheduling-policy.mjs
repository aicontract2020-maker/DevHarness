function add(reasons, code, summary, subject) {
  reasons.push({ code, summary, ...(subject ? { subject } : {}) });
}

function conflicts(left, right) {
  if (left.workspace_id && left.workspace_id === right.workspace_id) return true;
  for (const a of left.resources ?? []) {
    for (const b of right.resources ?? []) {
      const pathOverlap = a.kind === "path" && b.kind === "path" && (a.id === b.id || a.id.startsWith(`${b.id}/`) || b.id.startsWith(`${a.id}/`));
      const dataKinds = new Set(["data", "schema", "database"]);
      const dataOverlap = dataKinds.has(a.kind) && dataKinds.has(b.kind) && (a.id === b.id || a.id.startsWith(`${b.id}/`) || b.id.startsWith(`${a.id}/`));
      const sameResource = (a.kind === b.kind && a.id === b.id) || pathOverlap || dataOverlap;
      if (sameResource && (a.mode === "exclusive" || b.mode === "exclusive")) return true;
    }
  }
  return false;
}

function longestPath(node, nodes, memo, visiting = new Set()) {
  if (memo.has(node.task_id)) return memo.get(node.task_id);
  if (visiting.has(node.task_id)) return { duration: node.expected_duration_seconds, path: [node.task_id] };
  const dependents = nodes.filter((candidate) => candidate.depends_on.includes(node.task_id));
  const tails = dependents.map((item) => longestPath(item, nodes, memo, new Set(visiting).add(node.task_id)));
  const tail = tails.sort((left, right) => right.duration - left.duration || left.path.join("/").localeCompare(right.path.join("/")))[0];
  const result = { duration: node.expected_duration_seconds + (tail?.duration ?? 0), path: [node.task_id, ...(tail?.path ?? [])] };
  memo.set(node.task_id, result);
  return result;
}

function remainingDuration(node, nodes, memo, visiting = new Set()) {
  if (memo.has(node.task_id)) return memo.get(node.task_id);
  if (visiting.has(node.task_id)) return node.expected_duration_seconds;
  const nextVisiting = new Set(visiting).add(node.task_id);
  const dependents = nodes.filter((candidate) => candidate.depends_on.includes(node.task_id));
  const downstream = dependents.length === 0 ? 0 : Math.max(...dependents.map((item) => remainingDuration(item, nodes, memo, nextVisiting)));
  const duration = node.expected_duration_seconds + downstream;
  memo.set(node.task_id, duration);
  return duration;
}

export function createSchedule(plan) {
  const reasons = [];
  const nodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.task_id)) add(reasons, "task_duplicate", `Task ${node.task_id} is duplicated.`, node.task_id);
    byId.set(node.task_id, node);
  }
  if (!byId.has(plan?.integration_owner_task_id)) {
    add(reasons, "integration_owner_missing", "The integration owner must reference a task in the plan.", plan?.integration_owner_task_id);
  }
  for (const node of nodes) {
    if (!Array.isArray(node.resources) || node.resources.length === 0) add(reasons, "resource_claim_missing", `Task ${node.task_id} has no resource claims.`, node.task_id);
    for (const resource of node.resources ?? []) {
      if (resource.kind === "path" && (resource.id.startsWith("/") || resource.id.split("/").includes(".."))) add(reasons, "unsafe_path_resource", `Task ${node.task_id} has an unsafe path resource ${resource.id}.`, node.task_id);
    }
    for (const dependency of node.depends_on ?? []) {
      if (dependency === node.task_id) add(reasons, "self_dependency", `Task ${node.task_id} depends on itself.`, node.task_id);
      else if (!byId.has(dependency)) add(reasons, "dependency_missing", `Task ${node.task_id} references missing dependency ${dependency}.`, node.task_id);
    }
  }
  const integration = byId.get(plan?.integration_owner_task_id);
  if (integration) {
    const ancestors = new Set();
    const visit = (taskId) => {
      for (const dependency of byId.get(taskId)?.depends_on ?? []) {
        if (!ancestors.has(dependency)) {
          ancestors.add(dependency);
          visit(dependency);
        }
      }
    };
    visit(integration.task_id);
    const uncovered = nodes.filter((node) => node.task_id !== integration.task_id && !ancestors.has(node.task_id));
    if (uncovered.length > 0) add(reasons, "integration_barrier_incomplete", `Integration task does not depend on: ${uncovered.map((node) => node.task_id).join(", ")}.`, integration.task_id);
    const ownsBranch = integration.resources?.some((resource) => resource.kind === "external" && resource.id === "git:integration-branch" && resource.mode === "exclusive");
    const ownsWorkspace = integration.resources?.some((resource) => resource.kind === "workspace" && resource.id === integration.workspace_id && resource.mode === "exclusive");
    if (!ownsBranch || !ownsWorkspace) add(reasons, "integration_lock_missing", "Integration task requires exclusive integration-branch and workspace claims.", integration.task_id);
  }
  if (reasons.length > 0) return { valid: false, reasons, waves: [], critical_path: [] };

  const remaining = new Set(nodes.map((node) => node.task_id));
  const completed = new Set();
  const waves = [];
  const memo = new Map();
  while (remaining.size > 0) {
    const ready = nodes
      .filter((node) => remaining.has(node.task_id) && node.depends_on.every((dependency) => completed.has(dependency)))
      .sort((left, right) => remainingDuration(right, nodes, memo) - remainingDuration(left, nodes, memo) || left.task_id.localeCompare(right.task_id));
    if (ready.length === 0) {
      add(reasons, "dependency_cycle", "The task dependency graph contains a cycle.");
      return { valid: false, reasons, waves, critical_path: [] };
    }
    const selected = [];
    for (const candidate of ready) {
      if (selected.length >= plan.max_parallelism) break;
      if (!selected.some((existing) => conflicts(existing, candidate))) selected.push(candidate);
    }
    for (const node of selected) {
      remaining.delete(node.task_id);
      completed.add(node.task_id);
    }
    waves.push({ index: waves.length + 1, task_ids: selected.map((node) => node.task_id) });
  }
  const pathMemo = new Map();
  const criticalPath = nodes.map((node) => longestPath(node, nodes, pathMemo)).sort((left, right) => right.duration - left.duration || left.path.join("/").localeCompare(right.path.join("/")))[0]?.path ?? [];
  return { valid: true, reasons: [], waves, critical_path: criticalPath };
}
