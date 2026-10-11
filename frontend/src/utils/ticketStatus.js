/** Canonical ticket workflow statuses (YAML `status` values). */
export const TICKET_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "in_testing", label: "In testing" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * @param {string | null | undefined} status
 * @returns {string}
 */
export function formatTicketStatusLabel(status) {
  const key = String(status ?? "").trim().toLowerCase();
  const match = TICKET_STATUS_OPTIONS.find((opt) => opt.value === key);
  if (match) return match.label;
  if (!key) return "";
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}
