/**
 * Quick status filters for Releases navigator (same status values as TICKET_SEARCH_KEYS).
 */

import { TICKET_RELEASE_NONE } from "../constants/ticketRelease";

/** @type {{ value: string, label: string, icon: string, iconClass: string }[]} */
export const RELEASE_STATUS_QUICK_FILTERS = [
  {
    value: "open",
    label: "Open",
    icon: "Inbox",
    iconClass: "text-sky-600 dark:text-sky-400",
  },
  {
    value: "in_progress",
    label: "In progress",
    icon: "Timer",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  {
    value: "in_testing",
    label: "In testing",
    icon: "FlaskConical",
    iconClass: "text-violet-600 dark:text-violet-400",
  },
  {
    value: "blocked",
    label: "Blocked",
    icon: "OctagonAlert",
    iconClass: "text-rose-600 dark:text-rose-400",
  },
  {
    value: "done",
    label: "Done",
    icon: "CheckCircle2",
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
];

/** Work-queue pills for an opened ticket project (middle statuses + Done stay in Search). */
export const TICKET_PROJECT_STATUS_QUICK_FILTERS = RELEASE_STATUS_QUICK_FILTERS.filter(
  (f) => f.value === "open" || f.value === "blocked",
);

/**
 * Active status chip value, if any.
 * @param {Array<{ key?: string, value?: string }>|null|undefined} chips
 * @returns {string|null}
 */
export function getActiveStatusFromChips(chips) {
  if (!Array.isArray(chips)) return null;
  const chip = chips.find((c) => c?.key === "status" && String(c.value ?? "").trim());
  return chip ? String(chip.value).trim() : null;
}

/**
 * Toggle or replace the status chip. Other chips are preserved.
 * Clicking the active status removes it; clicking another replaces status only.
 *
 * @param {Array<{ key?: string, value?: string, paramKey?: string }>|null|undefined} chips
 * @param {string} statusValue
 * @returns {Array<{ key: string, value: string, paramKey?: string }>}
 */
export function applyOrToggleStatusChip(chips, statusValue) {
  const nextValue = String(statusValue ?? "").trim();
  if (!nextValue) {
    return Array.isArray(chips) ? chips.filter((c) => c?.key !== "status") : [];
  }

  const prev = Array.isArray(chips) ? chips.filter(Boolean) : [];
  const current = getActiveStatusFromChips(prev);
  const withoutStatus = prev.filter((c) => c?.key !== "status");

  if (current === nextValue) {
    return withoutStatus;
  }

  return [...withoutStatus, { key: "status", value: nextValue }];
}

/**
 * True when chips include the backlog (no-release) filter.
 * @param {Array<{ key?: string, value?: string }>|null|undefined} chips
 * @returns {boolean}
 */
export function getActiveBacklogFromChips(chips) {
  if (!Array.isArray(chips)) return false;
  return chips.some(
    (c) =>
      c?.key === "release" &&
      String(c.value ?? "").trim().toLowerCase() === TICKET_RELEASE_NONE,
  );
}

/**
 * Toggle the backlog chip (`release: __none__`). Status and other chips are preserved.
 * Replaces any other release chip (backlog vs specific release are mutually exclusive).
 * @param {Array<{ key?: string, value?: string, paramKey?: string }>|null|undefined} chips
 * @returns {Array<{ key: string, value: string, paramKey?: string }>}
 */
export function applyOrToggleBacklogChip(chips) {
  const prev = Array.isArray(chips) ? chips.filter(Boolean) : [];
  if (getActiveBacklogFromChips(prev)) {
    return prev.filter(
      (c) =>
        !(
          c?.key === "release" &&
          String(c.value ?? "").trim().toLowerCase() === TICKET_RELEASE_NONE
        ),
    );
  }
  const withoutRelease = prev.filter((c) => c?.key !== "release");
  return [...withoutRelease, { key: "release", value: TICKET_RELEASE_NONE }];
}
