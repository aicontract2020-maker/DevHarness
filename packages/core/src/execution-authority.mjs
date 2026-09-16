const CAPABILITY_ORDER = ["dependency-install", "service-runtime", "browser-runtime", "container-runtime", "database-runtime"];

export function requiredCapabilityIdsForVerification(plan) {
  const required = new Set(["service-runtime"]);
  if ((plan?.submodules ?? []).length > 0 || (plan?.services ?? []).length > 0) required.add("dependency-install");
  const commandText = `${plan?.command?.id ?? ""}\n${plan?.command?.run ?? ""}\n${plan?.command?.source ?? ""}`;
  const serviceText = (plan?.services ?? []).map((service) => `${service?.command?.run ?? ""}\n${service?.command?.source ?? ""}`).join("\n");
  if (/playwright|cypress|browser/i.test(commandText)) required.add("browser-runtime");
  if (/\bdocker(?:\s+compose)?\b/i.test(`${commandText}\n${serviceText}`)) required.add("container-runtime");
  return CAPABILITY_ORDER.filter((id) => required.has(id));
}

export function evaluateVerificationExecutionAuthority(plan, authorizationView, options = {}) {
  const reasons = [];
  if (!authorizationView || authorizationView.repository_identity !== plan?.repository_identity) {
    reasons.push({ code: "authorization_repository_mismatch", message: "Capability authorization belongs to another repository." });
  }
  const controlled = options.controlledChange ?? null;
  const controlledChangeRevisionOk = Boolean(
    controlled
    && controlled.baseline_head_sha
    && controlled.change_commit_sha
    && authorizationView?.head_sha === controlled.baseline_head_sha
    && plan?.commit_sha === controlled.change_commit_sha
  );
  if (!authorizationView || (authorizationView.head_sha !== plan?.commit_sha && !controlledChangeRevisionOk)) {
    reasons.push({ code: "authorization_revision_mismatch", message: "Capability authorization belongs to another revision." });
  }
  const byId = new Map((authorizationView?.capabilities ?? []).map((item) => [item.request.id, item]));
  const requiredSet = new Set(requiredCapabilityIdsForVerification(plan));
  if (requiredSet.has("container-runtime") && byId.has("database-runtime")) requiredSet.add("database-runtime");
  const required = CAPABILITY_ORDER.filter((id) => requiredSet.has(id));
  const missing = required
    .map((id) => ({ id, status: byId.get(id)?.status ?? "unrequested" }))
    .filter((item) => item.status !== "approved");
  for (const item of missing) {
    reasons.push({ code: "capability_not_approved", message: `${item.id} is ${item.status}; approved authority is required.` });
  }
  return { allowed: reasons.length === 0, required_capability_ids: required, missing, reasons };
}
