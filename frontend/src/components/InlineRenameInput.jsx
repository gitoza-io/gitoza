import { useEffect, useRef, useState } from "react";

/**
 * Inline edit input for tree rows (VS Code–style rename): focus on mount, blur/Enter to commit, Escape to cancel.
 * Reused for folder/suite rename (CaseTree, SidebarTree) and run rename (RunListTree).
 *
 * @param {string} initialValue - Current display name
 * @param {string} [placeholder] - Placeholder when empty
 * @param {(value: string | null) => void} onCommit - Called with new trimmed value on save, or null on cancel/unchanged
 * @param {(value: string) => void} [onValueChange] - Called when the user edits the input
 * @param {string} [className] - Optional extra classes for the input
 */
function InlineRenameInput({ initialValue = "", placeholder, onCommit, onValueChange, className = "" }) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (initialValue) inputRef.current?.select();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) {
      onCommit(trimmed);
    } else {
      onCommit(null);
    }
  };

  const baseClass =
    "min-w-0 flex-1 rounded border border-indigo-400 bg-white px-1.5 py-0.5 text-sm text-slate-900 outline-none ring-1 ring-indigo-400 dark:border-indigo-500 dark:bg-slate-800 dark:text-slate-100";

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onValueChange?.(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCommit(null);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      placeholder={placeholder}
      className={className ? `${baseClass} ${className}` : baseClass}
    />
  );
}

export default InlineRenameInput;
