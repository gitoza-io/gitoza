import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { getTagColorClass } from "../utils/tagColor";
import {
  parseQueryToken,
  suggestKeys,
  suggestValues,
  tabCompleteDraft,
} from "../utils/querySearch";

const CHIP_BASE =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition";
const CHIP_COLORS =
  "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300";

/**
 * Developer-oriented query search: type `status: open` + Enter → chip;
 * Tab autocompletes keys / enum values.
 *
 * @param {{
 *   searchKeys: Array<{ key: string, label?: string }>;
 *   filterOptions?: Record<string, string[]>;
 *   chips: Array<{ key: string, value: string }>;
 *   onChipsChange: (chips: Array<{ key: string, value: string }>) => void;
 *   placeholder?: string;
 * }} props
 */
function TreeQuerySearchBar({
  searchKeys = [],
  filterOptions = {},
  chips = [],
  onChipsChange,
  placeholder = "status: open · tag: smoke · free text",
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const keySuggestions = useMemo(
    () => suggestKeys(draft, searchKeys),
    [draft, searchKeys],
  );
  const valueSuggestions = useMemo(
    () => suggestValues(draft, searchKeys, filterOptions),
    [draft, searchKeys, filterOptions],
  );
  const suggestions = draft.includes(":") ? valueSuggestions : keySuggestions;
  const showSuggestions = suggestions.length > 0 && draft.trim().length > 0;

  useEffect(() => {
    setHighlight(0);
  }, [draft]);

  const chipLabel = useCallback(
    (chip) => {
      if (chip.key === "q") return "Search";
      return searchKeys.find((k) => k.key === chip.key)?.label ?? chip.key;
    },
    [searchKeys],
  );

  const chipDisplayValue = useCallback(
    (chip) => {
      const kd = searchKeys.find((k) => k.key === chip.key);
      const special = kd?.specialOptions?.find((opt) => opt.value === chip.value);
      if (special) return special.label || special.value;
      const opt = kd?.options?.find((o) => o.value === chip.value);
      if (opt) return opt.label || opt.value;
      return chip.value;
    },
    [searchKeys],
  );

  const commitToken = useCallback(
    (text) => {
      const parsed = parseQueryToken(text, searchKeys);
      if (!parsed) return;
      if (parsed.error) {
        setError(parsed.error);
        return;
      }
      setError("");
      setDraft("");
      onChipsChange?.([...(chips || []), parsed]);
    },
    [searchKeys, chips, onChipsChange],
  );

  const removeChip = useCallback(
    (idx) => {
      onChipsChange?.((chips || []).filter((_, i) => i !== idx));
    },
    [chips, onChipsChange],
  );

  const handleClear = useCallback(() => {
    if (draft.trim()) {
      setDraft("");
      setError("");
      return;
    }
    if (chips?.length) {
      onChipsChange?.([]);
      setError("");
    }
  }, [draft, chips, onChipsChange]);

  const applySuggestion = useCallback(
    (item) => {
      if (!item) return;
      if (item.completion?.includes(":") && !item.completion.endsWith(": ") && item.value) {
        // Value suggestion → commit as chip
        commitToken(item.completion);
        return;
      }
      setDraft(item.completion);
      setError("");
      inputRef.current?.focus();
    },
    [commitToken],
  );

  const handleKeyDown = (e) => {
    if (e.key === "Tab") {
      const completion = tabCompleteDraft(draft, searchKeys, filterOptions);
      if (completion) {
        e.preventDefault();
        if (
          draft.includes(":") &&
          completion.includes(":") &&
          !completion.endsWith(": ")
        ) {
          commitToken(completion);
        } else {
          setDraft(completion);
          setError("");
        }
      }
      return;
    }

    if (e.key === "ArrowDown" && showSuggestions) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && showSuggestions) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions && suggestions[highlight]) {
        applySuggestion(suggestions[highlight]);
        return;
      }
      commitToken(draft);
      return;
    }

    if (e.key === "Escape") {
      if (draft) {
        setDraft("");
        setError("");
      }
    }
  };

  const hasActive = Boolean(draft.trim() || chips?.length);

  return (
    <div className="relative z-30 flex flex-col gap-1.5 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          className="w-full rounded border border-border bg-input py-1.5 pl-7 pr-7 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary"
        />
        {hasActive ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted hover:bg-slate-100 hover:text-ink dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {showSuggestions ? (
          <ul
            ref={listRef}
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 mt-0.5 max-h-40 overflow-y-auto rounded border border-slate-200 bg-white py-0.5 shadow-md dark:border-slate-600 dark:bg-slate-800"
          >
            {suggestions.map((item, idx) => {
              const label = item.label || item.value || item.key;
              const hint = item.completion;
              return (
                <li key={`${hint}-${idx}`} role="option" aria-selected={idx === highlight}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between px-2 py-1 text-left text-sm ${
                      idx === highlight
                        ? "bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                        : "text-ink hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applySuggestion(item)}
                  >
                    <span>{label}</span>
                    <span className="ml-2 truncate text-xs text-muted">{hint}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {error ? (
        <p className="px-0.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      {chips?.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip, idx) => {
            const label = chipLabel(chip);
            const value = chipDisplayValue(chip);
            const showValue = value && String(value).trim().length > 0;
            return (
              <span
                key={`${chip.key}-${chip.value}-${idx}`}
                className={`${CHIP_BASE} ${chip.key === "tag" ? getTagColorClass(chip.value) : CHIP_COLORS}`}
              >
                <span className="font-semibold">
                  {label}
                  {showValue ? ":" : ""}
                </span>
                {showValue ? <span className="ml-1">{value}</span> : null}
                <button
                  type="button"
                  onClick={() => removeChip(idx)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  aria-label={`Remove ${chip.key}: ${chip.value}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default TreeQuerySearchBar;
