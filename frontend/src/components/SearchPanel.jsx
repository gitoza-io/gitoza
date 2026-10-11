import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Clock,
  Filter,
  Plus,
  Search,
  Star,
  StarOff,
  X,
} from "lucide-react";
import { TreeScrollContainer } from "../contexts/TreeScrollContext";
import FilterSelect from "./FilterSelect";
import ParamKeyValueComposer from "./ParamKeyValueComposer";
import TagChipPicker from "./TagChipPicker";
import { getTagColorClass } from "../utils/tagColor";
import {
  chipsToFormState,
  emptyFilterForm,
  formStateToChips,
  hasActiveFilterCriteria,
} from "../utils/filterForm";
import { resolveCanonicalParamKey } from "../utils/caseFilters";

const CHIP_BASE =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition";
const CHIP_COLORS =
  "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300";

function buildSelectOptions(keyDef, filterOptions) {
  if (!keyDef) return [];
  const special = (keyDef.specialOptions ?? []).map((opt) => ({
    value: opt.value,
    label: opt.label || opt.value,
  }));
  if (keyDef.options) return [...special, ...keyDef.options];
  if (keyDef.filterKey && filterOptions[keyDef.filterKey]) {
    return [
      ...special,
      ...filterOptions[keyDef.filterKey].map((v) => ({
        value: v,
        label: keyDef.filterKey === "directories" ? v.split("/").pop() || v : v,
      })),
    ];
  }
  return special;
}

/**
 * Full-height filter panel that lives inside the tree sidebar area.
 *
 * Two visual modes:
 * - **editing**: filter form with one row per criterion, Filter / Clear all, saved & recent.
 * - **results**: applied filter chips + results tree/list below.
 */
function SearchPanel({
  searchKeys,
  filterOptions = {},
  onSearch,
  onClose,
  history,
  favorites,
  onToggleFavorite,
  isFavorite,
  resultsContent = null,
  resultsInSeparateColumn = false,
  sidebarResultsContent = null,
  freeTextSearchKey = null,
  freeTextPlaceholder = "Search by ID, title, tag, path…",
  /** When set, keep applied chips in sync with parent (e.g. Releases status pills). */
  appliedChips = undefined,
}) {
  const [chips, setChips] = useState(() =>
    Array.isArray(appliedChips) ? appliedChips : [],
  );
  const [formState, setFormState] = useState(() =>
    emptyFilterForm(searchKeys, { freeTextSearchKey }),
  );
  const [mode, setMode] = useState(() =>
    Array.isArray(appliedChips) && appliedChips.length > 0 ? "results" : "editing",
  );
  const [paramDuplicateError, setParamDuplicateError] = useState("");
  const [paramDraft, setParamDraft] = useState({ key: "", value: "" });
  const paramComposerKeyRef = useRef(0);
  const handleParamDraftChange = useCallback((draft) => {
    setParamDraft({
      key: String(draft?.key ?? ""),
      value: String(draft?.value ?? ""),
    });
  }, []);

  const formOptions = useMemo(
    () => ({ freeTextSearchKey }),
    [freeTextSearchKey],
  );

  const appliedChipsKey =
    appliedChips === undefined ? null : JSON.stringify(appliedChips ?? []);

  useEffect(() => {
    if (appliedChipsKey === null) return;
    const next = Array.isArray(appliedChips) ? appliedChips : [];
    setChips((prev) => {
      if (JSON.stringify(prev) === appliedChipsKey) return prev;
      return next;
    });
    if (next.length > 0) {
      setMode("results");
      setFormState(chipsToFormState(next, searchKeys, formOptions));
    }
  }, [appliedChipsKey, appliedChips, searchKeys, formOptions]);

  const switchToEditing = useCallback(() => {
    setFormState(chipsToFormState(chips, searchKeys, formOptions));
    setMode("editing");
    setParamDuplicateError("");
  }, [chips, searchKeys, formOptions]);

  const updateFormField = useCallback((key, value) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const paramRows = useMemo(
    () => (Array.isArray(formState.param) ? formState.param : []),
    [formState.param],
  );

  const paramKeys = filterOptions.param_keys ?? [];
  const paramValuesByKey = filterOptions.param_values_by_key ?? {};
  const tagOptions = filterOptions.tags ?? [];

  const isDuplicateParamKey = useCallback(
    (paramKey) => {
      const lower = String(paramKey ?? "").trim().toLowerCase();
      if (!lower) return false;
      return paramRows.some(
        (row) => String(row.paramKey ?? "").trim().toLowerCase() === lower,
      );
    },
    [paramRows],
  );

  const handleParamConfirm = useCallback(
    ({ key, value }) => {
      if (isDuplicateParamKey(key)) {
        setParamDuplicateError("Key already used in filter");
        return;
      }
      setFormState((prev) => ({
        ...prev,
        param: [...(Array.isArray(prev.param) ? prev.param : []), { paramKey: key, value }],
      }));
      setParamDuplicateError("");
      setParamDraft({ key: "", value: "" });
      paramComposerKeyRef.current += 1;
      requestAnimationFrame(() => {
        document.activeElement?.blur?.();
      });
    },
    [isDuplicateParamKey],
  );

  const removeParamRow = useCallback((index) => {
    setFormState((prev) => ({
      ...prev,
      param: (Array.isArray(prev.param) ? prev.param : []).filter((_, i) => i !== index),
    }));
  }, []);

  const chipLabel = useCallback(
    (chip) => {
      if (freeTextSearchKey && chip.key === freeTextSearchKey) return "Search";
      if (chip.key === "param" && chip.paramKey) return chip.paramKey;
      return searchKeys.find((k) => k.key === chip.key)?.label ?? chip.key;
    },
    [searchKeys, freeTextSearchKey],
  );

  const chipDisplayValue = useCallback(
    (chip) => {
      if (chip.key === "param") return chip.value;
      const kd = searchKeys.find((k) => k.key === chip.key);
      const special = kd?.specialOptions?.find((opt) => opt.value === chip.value);
      if (special?.label) return special.label;
      if (kd?.filterKey === "directories") return chip.value.split("/").pop() || chip.value;
      return chip.value;
    },
    [searchKeys],
  );

  const applyChips = useCallback(
    (nextChips) => {
      setChips(nextChips);
      setFormState(chipsToFormState(nextChips, searchKeys, formOptions));
      onSearch(nextChips);
      setMode(nextChips.length > 0 ? "results" : "editing");
      setParamDuplicateError("");
      setParamDraft({ key: "", value: "" });
      paramComposerKeyRef.current += 1;
    },
    [onSearch, searchKeys, formOptions],
  );

  const executeFilter = useCallback(() => {
    let state = formState;
    const draftKey = resolveCanonicalParamKey(paramDraft.key, paramKeys).trim();
    const draftValue = String(paramDraft.value ?? "").trim();
    if (draftKey && draftValue) {
      if (isDuplicateParamKey(draftKey)) {
        setParamDuplicateError("Key already used in filter");
      } else {
        state = {
          ...formState,
          param: [
            ...(Array.isArray(formState.param) ? formState.param : []),
            { paramKey: draftKey, value: draftValue },
          ],
        };
      }
    }
    const next = formStateToChips(state, searchKeys, formOptions);
    if (next.length === 0) return;
    applyChips(next);
  }, [
    formState,
    paramDraft,
    paramKeys,
    isDuplicateParamKey,
    searchKeys,
    formOptions,
    applyChips,
  ]);

  const handleClearAll = useCallback(() => {
    const empty = emptyFilterForm(searchKeys, formOptions);
    setFormState(empty);
    setParamDuplicateError("");
    setParamDraft({ key: "", value: "" });
    paramComposerKeyRef.current += 1;
    if (mode === "results" || chips.length > 0) {
      setChips([]);
      onSearch([]);
    }
  }, [searchKeys, formOptions, mode, chips.length, onSearch]);

  const removeChip = useCallback(
    (idx) => {
      const next = chips.filter((_, i) => i !== idx);
      if (next.length === 0) {
        setChips([]);
        setFormState(emptyFilterForm(searchKeys, formOptions));
        onSearch([]);
        onClose();
        return;
      }
      applyChips(next);
    },
    [chips, onSearch, onClose, searchKeys, formOptions, applyChips],
  );

  const loadFromSaved = useCallback(
    (savedChips) => {
      applyChips(savedChips);
    },
    [applyChips],
  );

  useEffect(() => {
    const handleGlobalEsc = (e) => {
      if (e.key === "Escape" && mode === "editing") onClose();
    };
    document.addEventListener("keydown", handleGlobalEsc);
    return () => document.removeEventListener("keydown", handleGlobalEsc);
  }, [mode, onClose]);

  const draftParamKey = resolveCanonicalParamKey(paramDraft.key, paramKeys).trim();
  const draftParamValue = String(paramDraft.value ?? "").trim();
  const hasCompleteParamDraft =
    Boolean(draftParamKey && draftParamValue) && !isDuplicateParamKey(draftParamKey);
  const canFilter =
    hasActiveFilterCriteria(formState, searchKeys, formOptions) || hasCompleteParamDraft;
  const isEditing = mode === "editing";

  const renderFilterRow = (keyDef) => {
    if (keyDef.type === "tag") {
      return (
        <div key={keyDef.key} className="flex items-start gap-2">
          <span className="w-28 shrink-0 pt-1.5 text-xs font-medium text-muted dark:text-slate-400">
            {keyDef.label}
          </span>
          <div className="min-w-0 flex-1">
            <TagChipPicker
              options={tagOptions}
              value={Array.isArray(formState[keyDef.key]) ? formState[keyDef.key] : []}
              onChange={(next) => updateFormField(keyDef.key, next)}
              placeholder={keyDef.placeholder || "Select tags…"}
              emptyOptionsMessage="No tags indexed yet — try Refresh Workspace"
              refocusAfterSelect={false}
            />
          </div>
        </div>
      );
    }

    if (keyDef.type === "param") {
      return (
        <div key={keyDef.key} className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="w-28 shrink-0 pt-1.5 text-xs font-medium text-muted dark:text-slate-400">
              {keyDef.label}
            </span>
            <div className="min-w-0 flex-1">
              <ParamKeyValueComposer
                key={paramComposerKeyRef.current}
                paramKeys={paramKeys}
                paramValuesByKey={paramValuesByKey}
                label=""
                className="!block"
                autoFocusKey={false}
                duplicateKeyError={paramDuplicateError}
                onDuplicateKeyCheck={isDuplicateParamKey}
                onConfirm={handleParamConfirm}
                onDraftChange={handleParamDraftChange}
                confirmAriaLabel="Add custom field filter"
              />
            </div>
          </div>
          {paramRows.length > 0 && (
            <ul className="ml-[7.5rem] space-y-1">
              {paramRows.map((row, idx) => (
                <li
                  key={`${row.paramKey}-${row.value}-${idx}`}
                  className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <span className="font-semibold text-ink dark:text-slate-200">{row.paramKey}:</span>
                  <span className="min-w-0 flex-1 truncate text-ink dark:text-slate-300">{row.value}</span>
                  <button
                    type="button"
                    onClick={() => removeParamRow(idx)}
                    className="rounded p-0.5 text-muted hover:text-ink dark:hover:text-slate-200"
                    aria-label={`Remove ${row.paramKey} filter`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    if (keyDef.type === "enum" || keyDef.type === "user" || keyDef.type === "assignee") {
      const options = buildSelectOptions(keyDef, filterOptions);
      return (
        <FilterSelect
          key={keyDef.key}
          label={keyDef.label}
          value={String(formState[keyDef.key] ?? "")}
          onChange={(value) => updateFormField(keyDef.key, value)}
          options={options}
          emptyLabel="All"
        />
      );
    }

    return null;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden pt-2">
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2 dark:border-slate-700">
          {chips.map((chip, idx) => {
            const label = chipLabel(chip);
            const value = chipDisplayValue(chip);
            const showValue = value && value.trim().length > 0;
            return (
              <span
                key={`${chip.key}-${chip.value}-${idx}`}
                className={`${CHIP_BASE} ${chip.key === "tag" ? getTagColorClass(chip.value) : CHIP_COLORS}`}
              >
                <span className="font-semibold">
                  {label}
                  {showValue ? ":" : ""}
                </span>
                {showValue && <span className="ml-1">{value}</span>}
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
          {!isEditing && (
            <button
              type="button"
              onClick={switchToEditing}
              className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs text-muted transition hover:border-blue-400 hover:text-blue-600 dark:border-slate-600 dark:hover:border-blue-500 dark:hover:text-blue-400"
              title="Edit filters"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
          {!isEditing && (
            <button
              type="button"
              onClick={() => onToggleFavorite(chips)}
              className="ml-auto inline-flex items-center rounded p-1 text-muted hover:text-ink dark:hover:text-slate-200"
              title={isFavorite(chips) ? "Remove from favorites" : "Save as favorite"}
            >
              {isFavorite(chips) ? <StarOff className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      )}

      {isEditing ? (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {freeTextSearchKey && (
            <div className="mb-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={String(formState[freeTextSearchKey] ?? "")}
                  onChange={(e) => updateFormField(freeTextSearchKey, e.target.value)}
                  placeholder={freeTextPlaceholder}
                  className="w-full rounded border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                />
              </div>
            </div>
          )}

          <div className="mb-4 space-y-2.5">
            {searchKeys.map((keyDef) => renderFilterRow(keyDef))}
          </div>

          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={executeFilter}
              disabled={!canFilter}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Filter className="h-3.5 w-3.5" />
              Filter
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Clear all
            </button>
          </div>

          {(favorites.length > 0 || history.length > 0) && (
            <div className="border-t border-slate-100 pt-2 dark:border-slate-700" />
          )}

          {favorites.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 flex items-center gap-1 text-sm font-semibold tracking-wide text-muted dark:text-slate-500">
                <Star className="h-4 w-4" /> Saved
              </p>
              <ul className="space-y-0.5">
                {favorites.map((fav, fi) => (
                  <li key={fi}>
                    <button
                      type="button"
                      onClick={() => loadFromSaved(fav)}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-ink transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">
                        {fav.map((c, ci) => (
                          <span key={ci}>
                            {ci > 0 && ", "}
                            <span className="font-semibold">{chipLabel(c)}: </span>
                            {chipDisplayValue(c)}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {history.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 flex items-center gap-1 text-sm font-semibold tracking-wide text-muted dark:text-slate-500">
                <Clock className="h-4 w-4" /> Recent
              </p>
              <ul className="space-y-0.5">
                {history.map((entry, hi) => (
                  <li key={hi}>
                    <button
                      type="button"
                      onClick={() => loadFromSaved(entry)}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-ink transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">
                        {entry.map((c, ci) => (
                          <span key={ci}>
                            {ci > 0 && ", "}
                            <span className="font-semibold">{chipLabel(c)}: </span>
                            {chipDisplayValue(c)}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : resultsInSeparateColumn ? (
        sidebarResultsContent != null ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {sidebarResultsContent}
          </div>
        ) : (
          <div className="flex flex-1 items-start px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
            Results are shown in the case list panel.
          </div>
        )
      ) : (
        <TreeScrollContainer className="min-h-0 flex-1 overflow-y-auto pl-0 pr-2 pt-0 pb-2">
          {resultsContent}
        </TreeScrollContainer>
      )}
    </div>
  );
}

export default SearchPanel;
