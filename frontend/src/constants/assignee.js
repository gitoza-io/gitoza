export const ASSIGNEE_UNASSIGNED = "__unassigned__";
export const ASSIGNEE_UNASSIGNED_LABEL = "Unassigned";
/** Search filter sentinel resolved to git user.name on the server. */
export const ASSIGNED_TO_ME = "__me__";
export const ASSIGNED_TO_ME_LABEL = "Assigned to me";

export function isAssigneeUnassigned(stored) {
  if (stored == null || stored === "") return false;
  const t = String(stored).trim();
  return (
    t === ASSIGNEE_UNASSIGNED ||
    t.toLowerCase() === ASSIGNEE_UNASSIGNED_LABEL.toLowerCase()
  );
}

/** Case-insensitive match key for assignee names. */
export function assigneeMatchKey(s) {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Resolve input to a canonical workspace assignee when case-insensitively known.
 * Tie-break: first name in `knownNames` order (NOCASE-sorted from server).
 */
export function canonicalAssignee(input, knownNames = []) {
  const t = String(input ?? "").trim();
  if (!t) return "";
  if (isAssigneeUnassigned(t)) return ASSIGNEE_UNASSIGNED_LABEL;
  const key = assigneeMatchKey(t);
  for (const name of knownNames) {
    if (name && assigneeMatchKey(name) === key) {
      return String(name).trim();
    }
  }
  return t;
}

/** Run-header assignee shown when a case override is cleared. */
export function inheritedRunCaseAssignee(runAssignedTo) {
  return (runAssignedTo || "").trim();
}

/** Display value for run-case assignee field (effective, no inheritance hint). */
export function displayRunCaseAssignee(stored, runAssignedTo) {
  if (isAssigneeUnassigned(stored)) return ASSIGNEE_UNASSIGNED_LABEL;
  if (stored != null && String(stored).trim() !== "") return String(stored).trim();
  return inheritedRunCaseAssignee(runAssignedTo);
}

/** Map UI draft to value stored on run case (null = inherit run). */
export function storedFromDisplay(draft, runAssignedTo) {
  const t = (draft || "").trim();
  if (!t) return null;
  if (t.toLowerCase() === ASSIGNEE_UNASSIGNED_LABEL.toLowerCase()) {
    return ASSIGNEE_UNASSIGNED;
  }
  const run = (runAssignedTo || "").trim();
  if (run && assigneeMatchKey(t) === assigneeMatchKey(run)) return null;
  return t;
}

/** True when case has an explicit stored assignee (override or unassigned sentinel). */
export function hasExplicitRunCaseAssignee(stored) {
  return stored != null && String(stored).trim() !== "";
}

/** Client-side effective assignee (matches backend effective_assigned_to). */
export function effectiveRunCaseAssignee(stored, runAssignedTo) {
  if (isAssigneeUnassigned(stored)) return null;
  if (stored != null && String(stored).trim() !== "") return String(stored).trim();
  const run = inheritedRunCaseAssignee(runAssignedTo);
  return run || null;
}

export function filterAssigneeSuggestions(suggestions = []) {
  return suggestions.filter(
    (s) =>
      s &&
      s !== ASSIGNEE_UNASSIGNED &&
      s.toLowerCase() !== ASSIGNEE_UNASSIGNED_LABEL.toLowerCase(),
  );
}

/** Filter workspace assignee suggestions by query; empty query returns the full list. */
export function filterAssigneeSuggestionsByQuery(suggestions, query) {
  const base = filterAssigneeSuggestions(suggestions);
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return base;
  return base.filter((s) => s.toLowerCase().includes(q));
}
