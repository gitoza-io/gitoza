/**
 * Labeled filter row with a native select (empty value = "All").
 */
function FilterSelect({
  label,
  value = "",
  onChange,
  options = [],
  emptyLabel = "All",
  id,
  className = "",
}) {
  const selectId = id ?? `filter-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label
        htmlFor={selectId}
        className="w-28 shrink-0 text-xs font-medium text-muted"
      >
        {label}
      </label>
      <select
        id={selectId}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        className="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1.5 text-sm text-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary"
      >
        <option value="">{emptyLabel}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default FilterSelect;
