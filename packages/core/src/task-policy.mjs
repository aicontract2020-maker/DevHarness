export function evaluateTaskContract(task) {
  const reasons = [];
  for (const [domain, impact] of Object.entries(task?.impacts ?? {})) {
    if (impact.status === "unknown" && task.status === "ready") reasons.push({ code: "task_impact_unknown", summary: `Ready task ${task.id} has unknown ${domain} impact.`, subject: domain });
    if (impact.status === "affected" && ((impact.subjects ?? []).length === 0 || (impact.required_proof ?? []).length === 0)) reasons.push({ code: "task_impact_proof_missing", summary: `Affected ${domain} impact requires subjects and proof.`, subject: domain });
  }
  return { valid: reasons.length === 0, reasons };
}
