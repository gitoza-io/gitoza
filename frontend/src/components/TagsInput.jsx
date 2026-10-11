import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getTagColorClass } from "../utils/tagColor";
import { TagOptionRow } from "./TagBadge";

/**
 * Multi-tag chip input with suggestion dropdown portaled above editors / overflow.
 */
export default function TagsInput({
  value = [],
  onChange,
  options = [],
  disabled = false,
  className = "",
  placeholderEmpty = "Add tags…",
  placeholderMore = "Type and press Enter",
}) {
  const [tagInput, setTagInput] = useState("");
  const anchorRef = useRef(null);
  const [dropdownStyle, setDropdownStyle] = useState(null);

  const selected = useMemo(
    () => (Array.isArray(value) ? value.map((t) => String(t).trim()).filter(Boolean) : []),
    [value],
  );

  const suggestedTags = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [];
    const selectedSet = new Set(selected.map((t) => t.toLowerCase()));
    return (options || [])
      .map((t) => String(t).trim())
      .filter(Boolean)
      .filter((t) => t.toLowerCase().includes(q) && !selectedSet.has(t.toLowerCase()))
      .slice(0, 6);
  }, [tagInput, selected, options]);

  const showDropdown = !disabled && suggestedTags.length > 0;

  const updateDropdownPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 12 * 16),
      zIndex: 50,
    });
  }, []);

  useEffect(() => {
    if (!showDropdown) {
      setDropdownStyle(null);
      return undefined;
    }
    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);
    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [showDropdown, updateDropdownPosition, suggestedTags.length, tagInput, selected.length]);

  const addTag = useCallback(
    (raw) => {
      const tag = (raw || "").trim();
      if (!tag) return;
      if (selected.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        setTagInput("");
        return;
      }
      onChange?.([...selected, tag]);
      setTagInput("");
    },
    [onChange, selected],
  );

  const removeTag = useCallback(
    (tagToRemove) => {
      onChange?.(selected.filter((t) => t !== tagToRemove));
    },
    [onChange, selected],
  );

  const dropdown =
    showDropdown && dropdownStyle ? (
      <ul
        className="max-h-40 overflow-y-auto rounded-ui border border-slate-200 bg-white text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900"
        style={dropdownStyle}
        role="listbox"
      >
        {suggestedTags.map((tag) => (
          <li key={tag}>
            <TagOptionRow
              tag={tag}
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(tag);
              }}
            />
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div className={`relative min-w-[12rem] ${className}`.trim()} ref={anchorRef}>
      <div className="flex min-h-[2rem] flex-wrap items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-500 dark:bg-slate-950">
        {selected.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${getTagColorClass(tag)}`}
          >
            <span>{tag}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeTag(tag)}
              className="inline-flex h-3 w-3 items-center justify-center rounded-full text-[10px] text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={tagInput}
          disabled={disabled}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(tagInput);
            } else if (e.key === "Backspace" && !tagInput) {
              const last = selected[selected.length - 1];
              if (last) removeTag(last);
            }
          }}
          onBlur={() => addTag(tagInput)}
          placeholder={selected.length === 0 ? placeholderEmpty : placeholderMore}
          className="min-w-[6rem] flex-1 border-0 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 disabled:opacity-40 dark:text-slate-200 dark:placeholder:text-slate-500"
        />
      </div>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}
