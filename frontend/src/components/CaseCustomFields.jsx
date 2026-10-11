import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import ParamKeyValueComposer from "./ParamKeyValueComposer";
import { METADATA_CHIP_CLS, METADATA_EDIT_INPUT_CLS, METADATA_EDIT_INPUT_DEFAULT_CLS, METADATA_LABEL_CLS, MetadataFieldEdit, MetadataFieldRead } from "./MetadataField";
import { paramValuesForKey } from "../utils/caseFilters";

const FIELD_VALUE_INPUT_CLS = `${METADATA_EDIT_INPUT_CLS} ${METADATA_EDIT_INPUT_DEFAULT_CLS}`;
const FIELD_COMBOBOX_CLS =
  "w-24 min-w-[4.5rem] rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-500";
const PARAM_SUGGESTION_LIMIT = 50;

export function sortCustomFieldEntries(params) {
  return Object.entries(params ?? {})
    .map(([key, value]) => [String(key).trim(), String(value).trim()])
    .filter(([key, value]) => key && value)
    .sort(([a], [b]) => a.localeCompare(b));
}

function OptionRow({ label, onPick }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onPick(label);
      }}
      className="flex w-full items-center px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {label}
    </button>
  );
}

export function FieldCombobox({
  value,
  onChange,
  onCommit,
  options = [],
  placeholder,
  disabled = false,
  inputId,
  duplicateError = "",
  className = FIELD_COMBOBOX_CLS,
  maxSuggestions = 6,
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const query = (value || "").trim();

  const suggestions = useMemo(() => {
    const q = query.toLowerCase();
    const limit = maxSuggestions <= 0 ? options.length : maxSuggestions;
    if (!q) return options.slice(0, limit);
    return options
      .filter((opt) => {
        const lower = String(opt).toLowerCase();
        return lower.includes(q) && lower !== q;
      })
      .slice(0, limit);
  }, [query, options, maxSuggestions]);

  const showDropdown = open && !disabled && suggestions.length > 0;

  const updateDropdownPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      minWidth: Math.max(rect.width, 128),
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
  }, [showDropdown, updateDropdownPosition, suggestions.length, value]);

  const commit = useCallback(
    (next) => {
      const trimmed = (next ?? "").trim();
      onChange(trimmed);
      onCommit?.(trimmed);
      setOpen(false);
    },
    [onChange, onCommit],
  );

  const dropdown =
    showDropdown && dropdownStyle ? (
      <ul
        className="max-h-40 overflow-y-auto rounded-ui border border-slate-200 bg-white text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900"
        style={dropdownStyle}
        role="listbox"
      >
        {suggestions.map((opt) => (
          <li key={opt}>
            <OptionRow label={opt} onPick={commit} />
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div ref={anchorRef} className="relative min-w-0">
      <input
        id={inputId}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          commit(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(value);
          }
        }}
        placeholder={placeholder}
        className={className}
        aria-autocomplete="list"
        role="combobox"
        aria-expanded={showDropdown}
      />
      {duplicateError ? (
        <p className="absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap text-[10px] text-red-600 dark:text-red-400">
          {duplicateError}
        </p>
      ) : null}
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}

export function CustomFieldRead({ fieldKey, value }) {
  const key = String(fieldKey ?? "").trim();
  const val = String(value ?? "").trim();
  if (!key || !val) return null;

  return (
    <MetadataFieldRead
      label={key}
      value={val}
      title={val}
    />
  );
}

export function CustomFieldEdit({
  fieldKey,
  value,
  onValueChange,
  onRemove,
  disabled = false,
  paramKeys = [],
  paramValuesByKey = {},
}) {
  const key = String(fieldKey ?? "").trim();
  if (!key) return null;

  const valueOptions = useMemo(
    () => paramValuesForKey(key, paramValuesByKey, paramKeys),
    [key, paramValuesByKey, paramKeys],
  );

  return (
    <MetadataFieldEdit label={key}>
      <div className="flex items-center gap-1">
        <FieldCombobox
          value={value ?? ""}
          disabled={disabled}
          options={valueOptions}
          maxSuggestions={PARAM_SUGGESTION_LIMIT}
          className={FIELD_VALUE_INPUT_CLS}
          onChange={onValueChange}
          onCommit={onValueChange}
          placeholder="Value"
          inputId={undefined}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
          aria-label={`Remove ${key}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </MetadataFieldEdit>
  );
}

/**
 * Inline custom fields editor for the metadata strip (edit / create).
 */
export function CustomFieldsEditStrip({
  value = {},
  onChange,
  paramKeys = [],
  paramValuesByKey = {},
  disabled = false,
}) {
  const [draftOpen, setDraftOpen] = useState(false);
  const [duplicateKeyError, setDuplicateKeyError] = useState("");
  const lastExternalRef = useRef(JSON.stringify(value ?? {}));
  const shouldFocusDraftRef = useRef(false);
  const draftKeyRef = useRef(0);

  const persistedKeys = useMemo(() => {
    if (Array.isArray(paramKeys) && paramKeys.length > 0) {
      return Array.from(
        new Set(paramKeys.map((k) => String(k).trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b));
    }
    return [];
  }, [paramKeys]);

  const savedEntries = useMemo(() => sortCustomFieldEntries(value), [value]);

  useEffect(() => {
    const serialized = JSON.stringify(value ?? {});
    if (serialized === lastExternalRef.current) return;
    lastExternalRef.current = serialized;
    setDraftOpen(false);
    setDuplicateKeyError("");
  }, [value]);

  const emitParams = useCallback(
    (next) => {
      lastExternalRef.current = JSON.stringify(next);
      onChange?.(next);
    },
    [onChange],
  );

  const isDuplicateKey = useCallback(
    (key, excludeKey = null) => {
      const trimmed = (key || "").trim();
      if (!trimmed) return false;
      const lower = trimmed.toLowerCase();
      return Object.keys(value ?? {}).some((existing) => {
        if (excludeKey && existing.toLowerCase() === excludeKey.toLowerCase()) return false;
        return existing.toLowerCase() === lower;
      });
    },
    [value],
  );

  const handleStartDraft = useCallback(() => {
    if (disabled || draftOpen) return;
    shouldFocusDraftRef.current = true;
    draftKeyRef.current += 1;
    setDraftOpen(true);
    setDuplicateKeyError("");
  }, [disabled, draftOpen]);

  const handleCancelDraft = useCallback(() => {
    setDraftOpen(false);
    setDuplicateKeyError("");
  }, []);

  const handleConfirmDraft = useCallback(
    ({ key, value: val }) => {
      if (isDuplicateKey(key)) {
        setDuplicateKeyError("Key already used");
        return;
      }
      const next = { ...(value ?? {}), [key]: val };
      emitParams(next);
      setDraftOpen(false);
      setDuplicateKeyError("");
    },
    [value, isDuplicateKey, emitParams],
  );

  const handleValueChange = useCallback(
    (key, nextValue) => {
      const next = { ...(value ?? {}) };
      const raw = nextValue ?? "";
      if (!raw.trim()) {
        delete next[key];
      } else {
        next[key] = raw;
      }
      emitParams(next);
    },
    [value, emitParams],
  );

  const handleRemove = useCallback(
    (key) => {
      const next = { ...(value ?? {}) };
      delete next[key];
      emitParams(next);
    },
    [value, emitParams],
  );

  const showEmptyLabel = savedEntries.length === 0 && !draftOpen;

  return (
    <>
      {savedEntries.map(([key, val]) => (
        <CustomFieldEdit
          key={key}
          fieldKey={key}
          value={val}
          disabled={disabled}
          paramKeys={persistedKeys}
          paramValuesByKey={paramValuesByKey}
          onValueChange={(next) => handleValueChange(key, next)}
          onRemove={() => handleRemove(key)}
        />
      ))}

      {draftOpen ? (
        <ParamKeyValueComposer
          key={draftKeyRef.current}
          paramKeys={persistedKeys}
          paramValuesByKey={paramValuesByKey}
          disabled={disabled}
          autoFocusKey={shouldFocusDraftRef.current}
          duplicateKeyError={duplicateKeyError}
          onDuplicateKeyCheck={isDuplicateKey}
          onConfirm={handleConfirmDraft}
          onCancel={handleCancelDraft}
        />
      ) : null}

      <div className={`${METADATA_CHIP_CLS} !inline-flex`}>
        {showEmptyLabel ? (
          <span className={METADATA_LABEL_CLS}>Custom fields</span>
        ) : null}
        <button
          type="button"
          onClick={handleStartDraft}
          disabled={disabled || draftOpen}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
        >
          <Plus className="h-3 w-3" />
          Add field
        </button>
      </div>
    </>
  );
}
