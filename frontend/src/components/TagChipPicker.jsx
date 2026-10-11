import { useCallback, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { TagBadge, TagOptionRow } from "./TagBadge";
import { getTagColorClass } from "../utils/tagColor";

const CHIP_BASE =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition";

function normalizeTagKey(tag) {
  return String(tag ?? "").trim().toLowerCase();
}

/**
 * Compact searchable multi-tag picker (search-panel tag UX without full SearchPanel).
 */
function TagChipPicker({
  options = [],
  value = [],
  onChange,
  placeholder = "Search tags…",
  disabled = false,
  id = "tag-chip-picker-input",
  "aria-label": ariaLabel = "Search and select tags",
  emptyOptionsMessage = "No tags available.",
  /** When false, blur the input after picking a tag (filter panel UX). */
  refocusAfterSelect = true,
}) {
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef(null);

  const selectedKeys = useMemo(
    () => new Set(value.map((t) => normalizeTagKey(t)).filter(Boolean)),
    [value],
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((tag) => {
      const key = normalizeTagKey(tag);
      if (!key || selectedKeys.has(key)) return false;
      if (!q) return true;
      return tag.toLowerCase().includes(q);
    });
  }, [options, query, selectedKeys]);

  const addTag = useCallback(
    (tag) => {
      const label = String(tag ?? "").trim();
      const key = normalizeTagKey(label);
      if (!key || selectedKeys.has(key)) return;
      const canonical = options.find((t) => normalizeTagKey(t) === key) ?? label;
      onChange?.([...value, canonical]);
      setQuery("");
      if (refocusAfterSelect) {
        setDropdownOpen(true);
        inputRef.current?.focus();
      } else {
        setDropdownOpen(false);
        inputRef.current?.blur();
      }
    },
    [options, onChange, refocusAfterSelect, selectedKeys, value],
  );

  const removeTag = useCallback(
    (tagToRemove) => {
      const key = normalizeTagKey(tagToRemove);
      onChange?.(value.filter((t) => normalizeTagKey(t) !== key));
      inputRef.current?.focus();
    },
    [onChange, value],
  );

  const clearAll = useCallback(() => {
    onChange?.([]);
    setQuery("");
    setDropdownOpen(false);
    inputRef.current?.focus();
  }, [onChange]);

  const confirmSearch = useCallback(() => {
    setQuery("");
    setDropdownOpen(false);
    inputRef.current?.blur();
  }, []);

  const handleInputKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmSearch();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        confirmSearch();
        return;
      }
      if (e.key === "Backspace" && !query && value.length > 0) {
        removeTag(value[value.length - 1]);
      }
    },
    [confirmSearch, query, removeTag, value],
  );

  const showDropdown = dropdownOpen && !disabled && filteredOptions.length > 0;

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {value.map((tag) => (
              <span key={normalizeTagKey(tag)} className={`${CHIP_BASE} ${getTagColorClass(tag)}`}>
                <TagBadge tag={tag} size="xs" className="!bg-transparent !px-0 !py-0" />
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  disabled={disabled}
                  className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  aria-label={`Remove tag ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={clearAll}
            disabled={disabled}
            className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            aria-label="Clear all selected tags"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={query}
          disabled={disabled || options.length === 0}
          onChange={(e) => {
            setQuery(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setDropdownOpen(false), 150);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={options.length === 0 ? emptyOptionsMessage : placeholder}
          aria-label={ariaLabel}
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? `${id}-listbox` : undefined}
          role="combobox"
          aria-autocomplete="list"
          className="w-full rounded-sm border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
        />
        {showDropdown && (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-sm border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
          >
            {filteredOptions.map((tag) => (
              <li key={normalizeTagKey(tag)} role="option">
                <TagOptionRow
                  tag={tag}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addTag(tag)}
                />
              </li>
            ))}
          </ul>
        )}
        {dropdownOpen && !disabled && options.length > 0 && query && filteredOptions.length === 0 && (
          <p className="absolute z-10 mt-1 w-full rounded-sm border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            No matching tags
          </p>
        )}
      </div>
    </div>
  );
}

export default TagChipPicker;
