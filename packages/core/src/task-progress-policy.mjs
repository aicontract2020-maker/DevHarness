export function evaluateTaskProgress(progress) {
  const reasons = [];
  if (progress.completed_count > progress.total_count) reasons.push({ code: "progress_count_invalid", summary: "Completed count cannot exceed total count." });
  if (progress.status === "completed" && (progress.completed_count !== progress.total_count || progress.blockers.length > 0)) reasons.push({ code: "completed_progress_inconsistent", summary: "Completed progress requires all work complete and no blockers." });
  if (progress.status !== "completed" && progress.completed_count === progress.total_count) reasons.push({ code: "active_progress_complete", summary: "A fully completed count must use completed status." });
  if (progress.status === "blocked" && progress.blockers.length === 0) reasons.push({ code: "blocked_without_reason", summary: "Blocked progress requires at least one blocker." });
  if (progress.status !== "blocked" && progress.blockers.length > 0) reasons.push({ code: "blockers_status_mismatch", summary: "Only blocked progress may retain blockers." });
  if (progress.status !== "completed" && Date.parse(progress.next_update_at) <= Date.parse(progress.updated_at)) reasons.push({ code: "next_update_invalid", summary: "Active progress requires a future update time." });
  return { valid: reasons.length === 0, reasons };
}
