import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, User } from "lucide-react";
import {
  filterAssigneeSuggestionsByQuery,
  canonicalAssignee,
} from "../constants/assignee";
import Tooltip from "./Tooltip";

/**
 * Single-value assignee field with username suggestions (tag-style dropdown).
 */
export default function AssigneeInput({
  value = "",
  onChange,
  suggestions = [],
  placeholder = "—",
  disabled = false,
  className = "",
  inputClassName = "",
  specialOptions = [],
  showClear,
  onClear,
  onBlur: onBlurProp,
  clearVariant = "clear",
  clearLabel,
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const anchorRef = useRef(null);
  const [dropdownStyle, setDropdownStyle] = useState(null);

  const query = (value || "").trim();
  const filteredSuggestions = useMemo(
    () => filterAssigneeSuggestionsByQuery(suggestions, query),
    [query, suggestions],
  );

  const filteredSpecial = useMemo(() => {
    const q = query.toLowerCase();
    return specialOptions.filter((opt) => {
      const label = (opt.label || opt.value || "").toLowerCase();
      const val = (opt.value || "").toLowerCase();
      if (!q) return true;
      return label.includes(q) || val.includes(q);
    });
  }, [query, specialOptions]);

  const dropdownItems = useMemo(() => {
    const items = filteredSpecial.map((opt) => ({
      key: `special:${opt.value}`,
      value: opt.value,
      label: opt.label || opt.value,
    }));
    for (const name of filteredSuggestions) {
      items.push({ key: `user:${name}`, value: name, label: name });
    }
    return items;
  }, [filteredSpecial, filteredSuggestions]);

  const showDropdown = open && focused && dropdownItems.length > 0 && !disabled;
  const clearVisible = showClear ?? Boolean(value);

  const updateDropdownPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left + 16,
      width: "12rem",
      zIndex: 50,
    });
  }, []);

  useEffect(() => {
    if (!showDropdown) {
      setDropdownStyle(null);
      return;
    }
    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);
    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [showDropdown, updateDropdownPosition]);

  const pick = useCallback(
    (name) => {
      onChange?.(name);
      setOpen(false);
    },
    [onChange],
  );

  const handleClearClick = useCallback(() => {
    if (onClear) onClear();
    else onChange?.("");
  }, [onClear, onChange]);

  const isResetAction = clearVariant === "reset" && Boolean(clearLabel);
  const actionAriaLabel = isResetAction ? clearLabel : "Clear assignee";

  const actionButton = (
    <button
      type="button"
      onClick={handleClearClick}
      className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      aria-label={actionAriaLabel}
    >
      {isResetAction ? (
        <RotateCcw className="h-3 w-3" aria-hidden />
      ) : (
        <span className="px-0.5 text-[10px] leading-none">×</span>
      )}
    </button>
  );

  const dropdown = showDropdown && dropdownStyle ? (
    <ul
      className="max-h-40 overflow-y-auto rounded border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-900"
      style={dropdownStyle}
      role="listbox"
    >
      {dropdownItems.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            className="w-full px-2 py-1 text-left text-xs text-slate-700 hover:bg-indigo-50 dark:text-slate-200 dark:hover:bg-indigo-500/20"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(item.value)}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      <div className="flex items-center gap-1.5">
        <User className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange?.(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => {
            setFocused(false);
            setTimeout(() => setOpen(false), 150);
            const canonical = canonicalAssignee(value, suggestions);
            if (canonical !== (value || "")) {
              onChange?.(canonical);
            }
            onBlurProp?.();
          }}
          disabled={disabled}
          placeholder={placeholder}
          className={`box-border h-8 min-h-[2rem] w-32 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 placeholder:text-slate-300 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-indigo-500 dark:focus:ring-indigo-500 ${inputClassName}`.trim()}
          aria-autocomplete="list"
          role="combobox"
          aria-expanded={showDropdown}
        />
        {value && clearVisible && !disabled ? (
          isResetAction ? (
            <Tooltip label={clearLabel} placement="bottom">
              {actionButton}
            </Tooltip>
          ) : (
            actionButton
          )
        ) : null}
      </div>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}
