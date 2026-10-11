export const METADATA_CHIP_CLS =
  "inline-flex min-w-[6rem] max-w-full flex-col self-stretch gap-0.5 rounded-md border border-slate-200/90 bg-slate-100 px-2.5 py-1.5 shadow-sm transition-colors dark:border-slate-600/80 dark:bg-slate-800/90";

export const METADATA_LABEL_CLS =
  "text-[11px] font-semibold leading-none tracking-wide text-slate-600 dark:text-slate-300";

export const METADATA_VALUE_CLS =
  "truncate text-[13px] font-bold leading-tight";

export const METADATA_VALUE_DEFAULT_CLS = "text-slate-900 dark:text-slate-50";

export const METADATA_VALUE_SLOT_CLS =
  "flex min-h-[1.375rem] flex-1 items-center min-w-0";

export const METADATA_EDIT_SLOT_CLS =
  "flex min-h-[2rem] flex-1 items-center min-w-0";

export const METADATA_EDIT_INPUT_CLS =
  "box-border h-8 min-h-[2rem] w-28 min-w-[5rem] max-w-[10rem] rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400/40 dark:border-slate-500 dark:bg-slate-950 dark:focus:border-indigo-400 dark:focus:ring-indigo-500/30";

export const METADATA_EDIT_INPUT_DEFAULT_CLS = "text-slate-900 dark:text-slate-100";

/**
 * Read-only metadata chip: label on top, value or custom content below.
 */
export function MetadataFieldRead({
  label,
  value,
  valueClassName = "",
  title,
  children,
}) {
  if (!label) return null;

  return (
    <div className={METADATA_CHIP_CLS}>
      <span className={METADATA_LABEL_CLS}>{label}</span>
      <div className={METADATA_VALUE_SLOT_CLS}>
        {children ?? (
          <span
            className={`${METADATA_VALUE_CLS} ${valueClassName || METADATA_VALUE_DEFAULT_CLS}`.trim()}
            title={title ?? (typeof value === "string" ? value : undefined)}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Editable metadata chip: label on top, control slot below.
 */
export function MetadataFieldEdit({ label, children, className = "" }) {
  if (!label) return null;

  return (
    <div className={`${METADATA_CHIP_CLS} ${className}`.trim()}>
      <span className={METADATA_LABEL_CLS}>{label}</span>
      <div className={METADATA_EDIT_SLOT_CLS}>{children}</div>
    </div>
  );
}
