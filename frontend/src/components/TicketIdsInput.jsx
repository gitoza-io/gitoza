import { X } from "lucide-react";
import TicketParentInput from "./TicketParentInput";

/**
 * Multi ticket-id chips with the existing ticket search input to add another id.
 * Only resolved ticket ids are added; unmatched blur/Enter cancels the draft.
 */
export default function TicketIdsInput({
  value = [],
  onChange,
  repoSlug = null,
  disabled = false,
  className = "",
}) {
  const ids = Array.isArray(value) ? value : [];

  const addId = (raw) => {
    const id = String(raw ?? "").trim();
    if (!id) return;
    const exists = ids.some((x) => x.toLowerCase() === id.toLowerCase());
    if (exists) return;
    onChange?.([...ids, id]);
  };

  const removeId = (idToRemove) => {
    onChange?.(ids.filter((x) => x !== idToRemove));
  };

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`.trim()}>
      {ids.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-0.5 rounded-full border border-slate-300 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
        >
          {id}
          {!disabled ? (
            <button
              type="button"
              onClick={() => removeId(id)}
              className="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label={`Remove ${id}`}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
      {!disabled ? (
        <TicketParentInput
          value=""
          onPick={addId}
          repoSlug={repoSlug}
          className="mt-0"
        />
      ) : null}
    </div>
  );
}
