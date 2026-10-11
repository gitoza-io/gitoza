import { TICKET_RELEASE_NONE } from "../constants/ticketRelease";
import {
  collectParamsFromCases,
  paramValuesForKey,
  resolveCanonicalParamKey,
} from "./caseFilters";
import { itemMatchesEnum, itemMatchesQuery } from "./entityTreeSearch";

/**
 * Append catalog custom-field keys as frontmatter search keys (not a synthetic "Custom field" key).
 * Strips SearchPanel-only `type: "param"` entries so the query bar uses field names directly.
 * @param {Array} baseKeys
 * @param {{ param_keys?: string[] }} [filterOptions]
 * @returns {Array}
 */
export function withParamSearchKeys(baseKeys = [], filterOptions = {}) {
  const base = (Array.isArray(baseKeys) ? baseKeys : []).filter(
    (k) => k?.type !== "param" && k?.key !== "param",
  );
  const reserved = new Set(base.map((k) => String(k.key).toLowerCase()));
  const dynamic = [];
  for (const raw of filterOptions?.param_keys ?? []) {
    const key = String(raw ?? "").trim();
    if (!key) continue;
    if (reserved.has(key.toLowerCase())) continue;
    reserved.add(key.toLowerCase());
    dynamic.push({
      key,
      label: key,
      type: "param-field",
      multi: false,
      placeholder: "Select value…",
    });
  }
  return dynamic.length ? [...base, ...dynamic] : base;
}

/**
 * Parse a query draft into a chip.
 * - `status: open` → { key: "status", value: "open" }
 * - free text without `:` → { key: "q", value: "..." }
 * - unknown key → { error: "..." }
 *
 * @param {string} text
 * @param {Array<{ key: string }>} searchKeys
 * @returns {{ key: string, value: string } | { error: string } | null}
 */
export function parseQueryToken(text, searchKeys = []) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const colon = raw.indexOf(":");
  if (colon < 0) {
    return { key: "q", value: raw };
  }

  const keyPart = raw.slice(0, colon).trim().toLowerCase();
  const valuePart = raw.slice(colon + 1).trim();
  if (!keyPart) {
    return { error: "Missing filter key" };
  }

  const known = (searchKeys || []).find((k) => k.key.toLowerCase() === keyPart);
  if (!known) {
    return { error: `Unknown key: ${keyPart}` };
  }
  if (!valuePart) {
    return { error: `Missing value for ${known.key}` };
  }
  return { key: known.key, value: valuePart };
}

/**
 * Suggest keys matching a prefix (before any colon).
 * @param {string} draft
 * @param {Array<{ key: string, label?: string }>} searchKeys
 * @returns {Array<{ key: string, label: string, completion: string }>}
 */
export function suggestKeys(draft, searchKeys = []) {
  const raw = String(draft ?? "");
  if (raw.includes(":")) return [];
  const prefix = raw.trim().toLowerCase();
  if (!prefix) {
    return (searchKeys || []).map((k) => ({
      key: k.key,
      label: k.label || k.key,
      completion: `${k.key}: `,
    }));
  }
  return (searchKeys || [])
    .filter(
      (k) =>
        k.key.toLowerCase().startsWith(prefix) ||
        String(k.label || "")
          .toLowerCase()
          .startsWith(prefix),
    )
    .map((k) => ({
      key: k.key,
      label: k.label || k.key,
      completion: `${k.key}: `,
    }));
}

/**
 * Resolve option list for a search key from static options + filterOptions.
 * @param {{ key: string, options?: Array<{value:string,label?:string}>, specialOptions?: Array, filterKey?: string, type?: string }} keyDef
 * @param {Record<string, unknown>} filterOptions
 * @returns {Array<{ value: string, label: string }>}
 */
export function optionsForKey(keyDef, filterOptions = {}) {
  if (!keyDef) return [];
  const special = (keyDef.specialOptions ?? []).map((opt) => ({
    value: opt.value,
    label: opt.label || opt.value,
  }));
  if (keyDef.options?.length) {
    return [
      ...special,
      ...keyDef.options.map((o) => ({ value: o.value, label: o.label || o.value })),
    ];
  }
  if (keyDef.type === "param-field") {
    const values = paramValuesForKey(
      keyDef.key,
      filterOptions.param_values_by_key ?? {},
      filterOptions.param_keys ?? [],
    );
    return [...special, ...values.map((v) => ({ value: String(v), label: String(v) }))];
  }
  const dynamicKey = keyDef.filterKey || (keyDef.type === "tag" ? "tags" : keyDef.key);
  const dynamic = filterOptions[dynamicKey] || filterOptions[keyDef.key] || [];
  return [...special, ...dynamic.map((v) => ({ value: String(v), label: String(v) }))];
}

/**
 * Suggest values for draft like `status: op` or `status:`.
 * @param {string} draft
 * @param {Array} searchKeys
 * @param {Record<string, unknown>} filterOptions
 * @returns {Array<{ value: string, label: string, completion: string }>}
 */
export function suggestValues(draft, searchKeys = [], filterOptions = {}) {
  const raw = String(draft ?? "");
  const colon = raw.indexOf(":");
  if (colon < 0) return [];
  const keyPart = raw.slice(0, colon).trim().toLowerCase();
  const valuePrefix = raw.slice(colon + 1).trim().toLowerCase();
  const keyDef = (searchKeys || []).find((k) => k.key.toLowerCase() === keyPart);
  if (!keyDef) return [];
  const opts = optionsForKey(keyDef, filterOptions);
  return opts
    .filter(
      (o) =>
        !valuePrefix ||
        o.value.toLowerCase().startsWith(valuePrefix) ||
        o.label.toLowerCase().startsWith(valuePrefix),
    )
    .map((o) => ({
      value: o.value,
      label: o.label,
      completion: `${keyDef.key}: ${o.value}`,
    }));
}

/**
 * Best single key completion for Tab (exact prefix match preferred).
 * @param {string} draft
 * @param {Array} searchKeys
 * @param {Record<string, unknown>} [filterOptions]
 * @returns {string | null} completion text or null
 */
export function tabCompleteDraft(draft, searchKeys = [], filterOptions = {}) {
  const raw = String(draft ?? "");
  if (!raw.includes(":")) {
    const keys = suggestKeys(raw, searchKeys);
    if (keys.length === 1) return keys[0].completion;
    const exact = keys.find((k) => k.key.toLowerCase() === raw.trim().toLowerCase());
    return exact ? exact.completion : keys[0]?.completion ?? null;
  }
  const values = suggestValues(raw, searchKeys, filterOptions);
  if (values.length === 1) return values[0].completion;
  return null;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/**
 * @param {Array<{ tags?: string[], assigned_to?: string, release?: string, priority?: string, params?: Record<string, string> }>} tickets
 */
export function collectTicketFilterOptions(tickets = []) {
  const tags = [];
  const assigned_to = [];
  const releases = [];
  const priorities = [];
  for (const t of tickets) {
    for (const tag of t.tags || []) tags.push(tag);
    if (t.assigned_to) assigned_to.push(t.assigned_to);
    if (t.release) releases.push(t.release);
    if (t.priority) priorities.push(t.priority);
  }
  const { param_keys, param_values_by_key } = collectParamsFromCases(tickets);
  return {
    tags: uniqueSorted(tags),
    assigned_to: uniqueSorted(assigned_to),
    releases: uniqueSorted(releases),
    priorities: uniqueSorted(priorities),
    param_keys,
    param_values_by_key,
  };
}

/**
 * @param {Array<{ tags?: string[] }>} pages
 */
export function collectWikiFilterOptions(pages = []) {
  const tags = [];
  for (const p of pages) {
    for (const tag of p.tags || []) tags.push(tag);
  }
  return { tags: uniqueSorted(tags) };
}

function itemMatchesParamField(item, key, value, paramKeys = []) {
  const params = item?.params && typeof item.params === "object" ? item.params : {};
  const canonical = resolveCanonicalParamKey(key, paramKeys);
  const needle = String(value ?? "").trim().toLowerCase();
  if (!needle) return false;
  for (const [rawKey, rawVal] of Object.entries(params)) {
    if (String(rawKey).trim().toLowerCase() !== String(canonical).toLowerCase()) continue;
    if (String(rawVal ?? "").trim().toLowerCase() === needle) return true;
  }
  return false;
}

/**
 * Match one item against AND of chips.
 * @param {Record<string, unknown>} item
 * @param {Array<{ key: string, value: string }>} chips
 * @param {{ queryFields?: string[], paramKeys?: string[], searchKeys?: Array<{ key: string, type?: string }> }} [opts]
 */
export function itemMatchesSearchChips(item, chips, opts = {}) {
  const queryFields = opts.queryFields || ["title", "name"];
  const paramKeys = opts.paramKeys ?? [];
  const paramFieldKeys = new Set(
    (opts.searchKeys || [])
      .filter((k) => k?.type === "param-field")
      .map((k) => String(k.key).toLowerCase()),
  );
  for (const k of paramKeys) {
    paramFieldKeys.add(String(k).toLowerCase());
  }
  if (!chips?.length) return true;
  if (!item) return false;

  for (const chip of chips) {
    if (!chip?.key) continue;
    const key = chip.key;
    const value = String(chip.value ?? "").trim();
    if (!value && key !== "q") continue;

    if (key === "q") {
      if (!itemMatchesQuery(item, value, queryFields)) return false;
      continue;
    }
    if (key === "tag") {
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const needle = value.toLowerCase();
      if (!tags.some((t) => String(t).toLowerCase() === needle)) return false;
      continue;
    }
    if (key === "type") {
      const type = String(item.type || item.ticket_type || "").toLowerCase();
      if (type !== value.toLowerCase()) return false;
      continue;
    }
    if (key === "release") {
      const rel = String(item.release ?? "").trim();
      if (value === TICKET_RELEASE_NONE) {
        if (rel) return false;
      } else if (rel.toLowerCase() !== value.toLowerCase()) {
        return false;
      }
      continue;
    }
    if (key === "assigned_to") {
      if (!itemMatchesEnum(item, "assigned_to", value)) return false;
      continue;
    }
    const isParamField =
      paramFieldKeys.has(String(key).toLowerCase()) ||
      (item.params &&
        typeof item.params === "object" &&
        Object.keys(item.params).some(
          (k) => String(k).trim().toLowerCase() === String(key).toLowerCase(),
        ));
    if (isParamField) {
      if (!itemMatchesParamField(item, key, value, paramKeys)) return false;
      continue;
    }
    if (!itemMatchesEnum(item, key, value)) return false;
  }
  return true;
}
