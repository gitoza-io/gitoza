import { getTagColorClass } from "../utils/tagColor";

const SIZE_CLASSES = {
  xs: "text-[11px]",
  sm: "text-xs",
};

/**
 * Colored tag pill — same deterministic color as search and detail views.
 * @param {{ tag: string, size?: "xs" | "sm", className?: string }} props
 */
export function TagBadge({ tag, size = "sm", className = "" }) {
  const label = String(tag ?? "").trim();
  if (!label) return null;

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 font-medium ${SIZE_CLASSES[size] ?? SIZE_CLASSES.sm} ${getTagColorClass(label)} ${className}`.trim()}
    >
      {label}
    </span>
  );
}

/**
 * Clickable dropdown row wrapping a TagBadge (search picker, edit autocomplete).
 * @param {{ tag: string, onMouseDown?: (e: React.MouseEvent) => void, onClick?: (e: React.MouseEvent) => void, className?: string }} props
 */
export function TagOptionRow({ tag, onMouseDown, onClick, className = "" }) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-slate-50 dark:hover:bg-slate-700 ${className}`.trim()}
    >
      <TagBadge tag={tag} />
    </button>
  );
}
