import { Ban, CheckCircle2, FlaskConical, Inbox, OctagonAlert, Ship, Timer } from "lucide-react";
import Tooltip from "./Tooltip";
import { RELEASE_STATUS_QUICK_FILTERS } from "../utils/ticketStatusQuickFilter";

const STATUS_ICONS = {
  Inbox,
  Timer,
  FlaskConical,
  OctagonAlert,
  CheckCircle2,
  Ship,
  Ban,
};

/**
 * Status count icons for Releases / Tickets tree toolbar.
 * Matches toolbar button height (h-7); tinted icons stay colored; tooltip for labels.
 *
 * @param {{
 *   counts?: Record<string, number|null|undefined>;
 *   activeStatus?: string|null;
 *   onSelect?: (status: string|null) => void;
 *   disabled?: boolean;
 *   loading?: boolean;
 *   filters?: typeof RELEASE_STATUS_QUICK_FILTERS;
 *   entityLabel?: string;
 * }} props
 */
function ReleaseTicketStatusPills({
  counts = {},
  activeStatus = null,
  onSelect,
  disabled = false,
  loading = false,
  filters = RELEASE_STATUS_QUICK_FILTERS,
  entityLabel = "tickets",
}) {
  return (
    <div
      className="flex max-w-full min-w-0 items-center gap-0.5 overflow-x-auto"
      role="group"
      aria-label={`Filter ${entityLabel} by status`}
    >
      {filters.map(({ value, label, icon, iconClass }) => {
        const selected = activeStatus === value;
        const raw = counts[value];
        const countLabel =
          loading && (raw === undefined || raw === null)
            ? "—"
            : typeof raw === "number"
              ? String(raw)
              : "—";
        const isZero = typeof raw === "number" && raw === 0;
        const Icon = STATUS_ICONS[icon] || Inbox;
        return (
          <Tooltip key={value} label={`${label} · ${countLabel}`} placement="bottom">
            <button
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`${label}: ${countLabel} ${entityLabel}`}
              onClick={() => onSelect?.(selected ? null : value)}
              className={[
                "inline-flex h-7 shrink-0 items-center gap-1 rounded-ui border px-1.5 text-xs font-medium leading-none transition",
                "disabled:pointer-events-none disabled:opacity-40",
                selected
                  ? "border-slate-300 bg-slate-200 dark:border-slate-500 dark:bg-slate-600"
                  : "border-transparent hover:bg-list-hover dark:hover:bg-slate-700",
              ].join(" ")}
            >
              <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} aria-hidden strokeWidth={2} />
              <span
                className={[
                  "min-w-[0.75rem] text-center tabular-nums",
                  isZero
                    ? "text-slate-400 dark:text-slate-500"
                    : "text-slate-700 dark:text-slate-200",
                ].join(" ")}
              >
                {countLabel}
              </span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export default ReleaseTicketStatusPills;
