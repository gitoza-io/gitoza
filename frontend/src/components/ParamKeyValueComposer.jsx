import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { FieldCombobox } from "./CaseCustomFields";
import { MetadataFieldEdit } from "./MetadataField";
import { paramValuesForKey, resolveCanonicalParamKey } from "../utils/caseFilters";

const PARAM_SUGGESTION_LIMIT = 50;

/**
 * Key → value composer for custom params (search + case editor).
 *
 * @param {{
 *   paramKeys?: string[],
 *   paramValuesByKey?: Record<string, string[]>,
 *   onConfirm: (payload: { key: string, value: string }) => void,
 *   onCancel?: () => void,
 *   onDraftChange?: (draft: { key: string, value: string }) => void,
 *   disabled?: boolean,
 *   autoFocusKey?: boolean,
 *   label?: string,
 *   duplicateKeyError?: string,
 *   onDuplicateKeyCheck?: (key: string) => boolean,
 *   keyPlaceholder?: string,
 *   valuePlaceholder?: string,
 *   confirmAriaLabel?: string,
 *   cancelAriaLabel?: string,
 *   className?: string,
 * }} props
 */
function ParamKeyValueComposer({
  paramKeys = [],
  paramValuesByKey = {},
  onConfirm,
  onCancel,
  onDraftChange,
  disabled = false,
  autoFocusKey = true,
  label = "New field",
  duplicateKeyError: duplicateKeyErrorProp = "",
  onDuplicateKeyCheck,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  confirmAriaLabel = "Confirm custom field",
  cancelAriaLabel = "Cancel custom field",
  className = "",
}) {
  const baseId = useId();
  const [draft, setDraft] = useState({ key: "", value: "" });
  const [duplicateKeyError, setDuplicateKeyError] = useState(duplicateKeyErrorProp);
  const shouldFocusKeyRef = useRef(autoFocusKey);

  const persistedKeys = useMemo(
    () =>
      Array.from(new Set(paramKeys.map((k) => String(k).trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [paramKeys],
  );

  const canonicalKey = useMemo(
    () => resolveCanonicalParamKey(draft.key, persistedKeys),
    [draft.key, persistedKeys],
  );

  const valueOptions = useMemo(
    () => paramValuesForKey(canonicalKey, paramValuesByKey, persistedKeys),
    [canonicalKey, paramValuesByKey, persistedKeys],
  );

  useEffect(() => {
    setDuplicateKeyError(duplicateKeyErrorProp);
  }, [duplicateKeyErrorProp]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  useEffect(() => {
    if (!shouldFocusKeyRef.current) return;
    shouldFocusKeyRef.current = false;
    requestAnimationFrame(() => {
      document.getElementById(`${baseId}-param-key`)?.focus();
    });
  }, [baseId]);

  const checkDuplicate = useCallback(
    (key) => {
      if (!onDuplicateKeyCheck) return false;
      return onDuplicateKeyCheck(key);
    },
    [onDuplicateKeyCheck],
  );

  const handleConfirm = useCallback(() => {
    const key = canonicalKey.trim();
    const val = draft.value.trim();
    if (!key) {
      setDuplicateKeyError("Key is required");
      return;
    }
    if (!val) return;
    if (checkDuplicate(key)) {
      setDuplicateKeyError("Key already used");
      return;
    }
    onConfirm?.({ key, value: val });
  }, [canonicalKey, draft.value, checkDuplicate, onConfirm]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && canonicalKey.trim() && draft.value.trim()) {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
    },
    [canonicalKey, draft.value, handleConfirm, onCancel],
  );

  const displayDuplicateError = duplicateKeyError || duplicateKeyErrorProp;

  const content = (
    <div className="flex flex-wrap items-center gap-1.5" onKeyDown={handleKeyDown}>
        <FieldCombobox
          inputId={`${baseId}-param-key`}
          value={draft.key}
          disabled={disabled}
          options={persistedKeys}
          placeholder={keyPlaceholder}
          maxSuggestions={PARAM_SUGGESTION_LIMIT}
          duplicateError={displayDuplicateError}
          onChange={(nextKey) => {
            setDraft((prev) => ({ ...prev, key: nextKey }));
            if (duplicateKeyError) setDuplicateKeyError("");
          }}
          onCommit={(nextKey) => {
            if (checkDuplicate(resolveCanonicalParamKey(nextKey, persistedKeys))) {
              setDuplicateKeyError("Key already used");
            }
          }}
        />
        <FieldCombobox
          inputId={`${baseId}-param-value`}
          value={draft.value}
          disabled={disabled || !canonicalKey.trim() || Boolean(displayDuplicateError)}
          options={valueOptions}
          placeholder={valuePlaceholder}
          maxSuggestions={PARAM_SUGGESTION_LIMIT}
          className="w-28 min-w-[5rem] rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-500"
          onChange={(nextValue) => setDraft((prev) => ({ ...prev, value: nextValue }))}
        />
        <button
          type="button"
          onClick={handleConfirm}
          disabled={
            disabled ||
            !canonicalKey.trim() ||
            !draft.value.trim() ||
            Boolean(displayDuplicateError)
          }
          className="inline-flex h-6 w-6 items-center justify-center rounded text-emerald-600 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
          aria-label={confirmAriaLabel}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label={cancelAriaLabel}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
  );

  if (!label) {
    return <div className={className}>{content}</div>;
  }

  return (
    <MetadataFieldEdit label={label} className={`!inline-flex ${className}`.trim()}>
      {content}
    </MetadataFieldEdit>
  );
}

export default ParamKeyValueComposer;
