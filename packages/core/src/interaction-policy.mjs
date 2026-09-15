const BLOCKING_VERDICTS = new Set(["action-required", "blocked", "failed"]);

function addReason(reasons, code, summary) {
  reasons.push({ code, summary });
}

function sameMembers(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every((item) => expected.has(item));
}

export function evaluateInteractionPacket(packet) {
  const reasons = [];
  const sections = Array.isArray(packet?.sections) ? packet.sections : [];
  const items = sections.flatMap((section) => (Array.isArray(section.items) ? section.items : []));
  const decisions = Array.isArray(packet?.decisions) ? packet.decisions : [];
  const artifacts = Array.isArray(packet?.source_artifacts) ? packet.source_artifacts : [];
  const mappings = Array.isArray(packet?.traceability) ? packet.traceability : [];
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const mappingByItem = new Map(mappings.map((mapping) => [mapping.item_id, mapping.source_refs]));

  if (packet?.compression?.source_artifact_count !== artifacts.length) {
    addReason(reasons, "source_count_mismatch", "Compression source count does not match the referenced artifacts.");
  }

  const surfacedCount = items.length + decisions.length;
  if (packet?.compression?.surfaced_item_count !== surfacedCount) {
    addReason(reasons, "surface_count_mismatch", "Compression surfaced count does not match the visible claims and decisions.");
  }

  if (sections.length > 9) {
    addReason(reasons, "section_bound_exceeded", "A developer packet can surface at most nine sections.");
  }

  if (decisions.length > 3) {
    addReason(reasons, "decision_bound_exceeded", "A developer packet can surface at most three decisions.");
  }

  for (const item of items) {
    const mappedSources = mappingByItem.get(item.id);
    if (!mappedSources) {
      addReason(reasons, "item_untraceable", `Surfaced item ${item.id} has no traceability mapping.`);
      continue;
    }

    if (!sameMembers(item.source_refs, mappedSources)) {
      addReason(reasons, "item_mapping_mismatch", `Surfaced item ${item.id} disagrees with its traceability mapping.`);
    }

    for (const sourceRef of mappedSources) {
      if (!artifactIds.has(sourceRef)) {
        addReason(reasons, "source_missing", `Surfaced item ${item.id} references unknown artifact ${sourceRef}.`);
      }
    }
  }

  for (const decision of decisions) {
    const mappedSources = mappingByItem.get(decision.id);
    if (!mappedSources) {
      addReason(reasons, "decision_untraceable", `Decision ${decision.id} has no traceability mapping.`);
      continue;
    }

    for (const sourceRef of mappedSources) {
      if (!artifactIds.has(sourceRef)) {
        addReason(reasons, "source_missing", `Decision ${decision.id} references unknown artifact ${sourceRef}.`);
      }
    }
  }

  const blockingItems = items.filter((item) => item.severity === "blocking");
  if (blockingItems.length > 0 && !BLOCKING_VERDICTS.has(packet?.verdict)) {
    addReason(reasons, "blocking_item_hidden", "A packet with blocking items cannot be informational or ready.");
  }

  for (const decision of decisions) {
    if (!decision.options?.some((option) => option.id === decision.recommended_option_id)) {
      addReason(reasons, "recommendation_missing", `Decision ${decision.id} recommends an option that is not present.`);
    }
  }

  if (decisions.length > 0) {
    if (packet?.attention?.required !== true || packet.attention.count < decisions.length) {
      addReason(reasons, "decision_without_attention", "Every unresolved decision must appear in the developer attention count.");
    }
    if (packet?.verdict === "informational" || packet?.verdict === "ready") {
      addReason(reasons, "decision_hidden_by_verdict", "A packet with unresolved decisions must require action or report a blocker/failure.");
    }
  }

  const reasonsSet = new Set(packet?.attention?.reasons ?? []);
  if ((packet?.kind === "alignment-brief" || packet?.kind === "delivery-brief") && packet?.verdict === "ready") {
    if (packet?.attention?.required !== true || !reasonsSet.has("gate-approval")) {
      addReason(reasons, "gate_attention_missing", "A ready Alignment or Delivery Brief must request explicit gate approval.");
    }
    const approveActions = (packet?.actions ?? []).filter((action) => action.kind === "approve");
    if (approveActions.length !== 1 || approveActions[0].recommended !== true) {
      addReason(reasons, "approval_action_missing", "A ready Alignment or Delivery Brief must expose exactly one recommended approve action.");
    }
  }

  if (packet?.kind === "decision-queue") {
    if (decisions.length === 0 || packet?.attention?.required !== true || packet?.verdict !== "action-required") {
      addReason(reasons, "invalid_decision_queue", "A Decision Queue must contain decisions and require action.");
    }
    if ((packet?.actions ?? []).some((action) => action.kind === "approve")) {
      addReason(reasons, "approve_action_hidden", "A Decision Queue must never offer approve as a next action.");
    }
    const recommendedActions = (packet?.actions ?? []).filter((action) => action.recommended);
    if (recommendedActions.length !== 1 || !["answer", "inspect"].includes(recommendedActions[0]?.kind)) {
      addReason(reasons, "decision_action_shape", "A Decision Queue must expose exactly one recommended answer or inspect action.");
    }
  }

  if (packet?.kind === "progress-pulse") {
    if (decisions.length > 0 || packet?.attention?.required !== false || packet?.attention?.count !== 0) {
      addReason(reasons, "progress_requires_action", "A Progress Pulse is a no-action view and cannot carry unresolved decisions.");
    }
    const actions = Array.isArray(packet?.actions) ? packet.actions : [];
    if (actions.length !== 1 || actions[0].kind !== "inspect" || actions[0].recommended !== true) {
      addReason(reasons, "progress_action_shape", "A Progress Pulse must expose exactly one recommended inspect action.");
    }
  }

  if (packet?.attention?.required === false && packet?.attention?.count !== 0) {
    addReason(reasons, "attention_count_inconsistent", "A no-action packet must have a zero attention count.");
  }

  const recommendedActions = (packet?.actions ?? []).filter((action) => action.recommended);
  if (recommendedActions.length !== 1) {
    addReason(reasons, "recommended_action_count", "Every packet must identify exactly one recommended next action.");
  }

  return { valid: reasons.length === 0, reasons };
}
