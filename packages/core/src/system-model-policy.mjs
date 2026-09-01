import { isTrustedEvaluationContext } from "./trusted-context.mjs";

function ids(values, label, reasons) {
  const result = new Set();
  for (const value of values ?? []) {
    if (result.has(value.id)) reasons.push({ code: `${label}_duplicate`, summary: `${label} ${value.id} is duplicated.`, subject: value.id });
    result.add(value.id);
  }
  return result;
}

function evidenceIsCurrent(record, model) {
  return record?.subject?.repository_identity === model.repository_identity && record.subject.commit_sha === model.commit_sha && ["pass", "observed"].includes(record.observation?.result) && (record.artifacts ?? []).length > 0;
}

export function evaluateSystemModel(model, { trustContext } = {}) {
  const reasons = [];
  const trusted = isTrustedEvaluationContext(trustContext);
  const inventory = trusted ? trustContext.inventory : null;
  const evidence = trusted ? trustContext.evidence : [];
  if (!trusted) reasons.push({ code: "trusted_model_context_missing", summary: "System-model readiness requires live discovery and verified evidence from the trusted runtime boundary." });
  const currentHeadSha = inventory?.currentHeadSha;
  const repositoryIdentity = inventory?.repositoryIdentity;
  if (!currentHeadSha || model?.commit_sha !== currentHeadSha) reasons.push({ code: "system_model_stale", summary: "System model is not bound to the current revision." });
  if (!repositoryIdentity || model?.repository_identity !== repositoryIdentity) reasons.push({ code: "system_model_repository_mismatch", summary: "System model repository identity does not match the active repository." });
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));
  const components = ids(model?.components, "component", reasons);
  const stores = ids(model?.stores, "store", reasons);
  const entities = ids(model?.entities, "entity", reasons);
  ids(model?.trust_boundaries, "trust_boundary", reasons);
  ids(model?.roles, "role", reasons);
  ids(model?.flows, "flow", reasons);
  ids(model?.invariants, "invariant", reasons);
  ids(model?.risks, "risk", reasons);

  for (const kind of inventory?.requiredComponentKinds ?? []) {
    if (!(model?.components ?? []).some((component) => component.kind === kind)) reasons.push({ code: "required_component_missing", summary: `Live repository discovery requires a modeled ${kind} component.`, subject: kind });
  }
  if (inventory?.databaseRequired && ((model?.stores ?? []).length === 0 || (model?.entities ?? []).length === 0)) reasons.push({ code: "database_inventory_incomplete", summary: "A detected database requires modeled stores and entities." });
  if (inventory?.securityRequired && ((model?.roles ?? []).length === 0 || (model?.trust_boundaries ?? []).length === 0)) reasons.push({ code: "security_inventory_incomplete", summary: "A live system requires modeled roles and trust boundaries." });

  for (const entity of model?.entities ?? []) {
    if (!stores.has(entity.store_id)) reasons.push({ code: "entity_store_missing", summary: `Entity ${entity.id} references unknown store ${entity.store_id}.`, subject: entity.id });
    if (!components.has(entity.owner_component_id)) reasons.push({ code: "entity_owner_missing", summary: `Entity ${entity.id} references unknown owner ${entity.owner_component_id}.`, subject: entity.id });
    const store = (model.stores ?? []).find((candidate) => candidate.id === entity.store_id);
    if (model?.verdict === "complete" && store && store.disposable_test_available !== true) reasons.push({ code: "disposable_store_missing", summary: `Complete model requires disposable test support for store ${store.id}.`, subject: store.id });
  }
  for (const boundary of model?.trust_boundaries ?? []) {
    if (!components.has(boundary.from_component_id) || !components.has(boundary.to_component_id)) reasons.push({ code: "trust_boundary_component_missing", summary: `Trust boundary ${boundary.id} references an unknown component.`, subject: boundary.id });
  }
  for (const flow of model?.flows ?? []) {
    if (!(flow.steps ?? []).some((step) => (step.reads ?? []).length > 0 || (step.writes ?? []).length > 0 || (step.calls ?? []).length > 0)) reasons.push({ code: "flow_has_no_effect", summary: `Flow ${flow.id} does not describe any read, write or component call.`, subject: flow.id });
    for (const [index, step] of (flow.steps ?? []).entries()) {
      if (step.sequence !== index + 1) reasons.push({ code: "flow_sequence_invalid", summary: `Flow ${flow.id} steps must be contiguous from one.`, subject: flow.id });
      if (!components.has(step.component_id)) reasons.push({ code: "flow_component_missing", summary: `Flow ${flow.id} references unknown component ${step.component_id}.`, subject: flow.id });
      for (const entityId of [...(step.reads ?? []), ...(step.writes ?? [])]) {
        if (!entities.has(entityId)) reasons.push({ code: "flow_entity_missing", summary: `Flow ${flow.id} references unknown entity ${entityId}.`, subject: flow.id });
      }
      for (const target of step.calls ?? []) {
        if (!components.has(target) && !stores.has(target)) reasons.push({ code: "flow_call_missing", summary: `Flow ${flow.id} calls unknown target ${target}.`, subject: flow.id });
      }
      for (const evidenceRef of step.evidence_refs ?? []) {
        if (!evidenceIsCurrent(evidenceById.get(evidenceRef), model)) reasons.push({ code: "flow_evidence_invalid", summary: `Flow ${flow.id} references missing or stale evidence ${evidenceRef}.`, subject: flow.id });
      }
      if (model?.verdict === "complete" && (step.evidence_refs ?? []).length === 0) reasons.push({ code: "complete_flow_unproved", summary: `Complete flow ${flow.id} has an unproved step.`, subject: flow.id });
    }
  }
  for (const invariant of model?.invariants ?? []) {
    for (const entityId of invariant.entity_ids ?? []) if (!entities.has(entityId)) reasons.push({ code: "invariant_entity_missing", summary: `Invariant ${invariant.id} references unknown entity ${entityId}.`, subject: invariant.id });
    for (const evidenceRef of invariant.test_refs ?? []) if (!evidenceIsCurrent(evidenceById.get(evidenceRef), model)) reasons.push({ code: "invariant_evidence_invalid", summary: `Invariant ${invariant.id} references missing or stale evidence ${evidenceRef}.`, subject: invariant.id });
  }
  const invariantEntities = new Set((model?.invariants ?? []).flatMap((invariant) => invariant.entity_ids ?? []));
  for (const flow of model?.flows ?? []) for (const step of flow.steps ?? []) for (const entityId of step.writes ?? []) if (!invariantEntities.has(entityId)) reasons.push({ code: "write_invariant_missing", summary: `Write to ${entityId} has no declared tested invariant.`, subject: flow.id });
  for (const risk of model?.risks ?? []) {
    if (risk.classification === "false-positive" && ((risk.evidence_refs ?? []).length === 0 || risk.evidence_refs.some((ref) => !evidenceIsCurrent(evidenceById.get(ref), model)))) reasons.push({ code: "false_positive_unproved", summary: `False-positive risk ${risk.id} requires current verified counter-evidence.`, subject: risk.id });
    if (model?.verdict === "complete" && ["goal-blocking", "unverified"].includes(risk.classification)) reasons.push({ code: "complete_with_blocking_risk", summary: `Complete model retains ${risk.classification} risk ${risk.id}.`, subject: risk.id });
  }
  if (model?.verdict === "complete" && (model.unknowns ?? []).length > 0) reasons.push({ code: "complete_with_unknowns", summary: "A complete system model cannot retain unresolved unknowns." });
  if (model?.verdict === "complete" && (model.flows ?? []).length === 0) reasons.push({ code: "complete_without_flows", summary: "A complete system model requires at least one end-to-end flow." });
  const sensitive = (model?.entities ?? []).some((entity) => (entity.classifications ?? []).length > 0);
  if (model?.verdict === "complete" && sensitive && ((model.roles ?? []).length === 0 || (model.trust_boundaries ?? []).length === 0)) reasons.push({ code: "security_model_incomplete", summary: "Sensitive data requires roles and trust-boundary coverage." });
  return { valid: reasons.length === 0, reasons };
}
