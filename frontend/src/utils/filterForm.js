/**
 * Convert between filter form state and SearchPanel chip arrays.
 */

/**
 * @typedef {{ key: string, paramKey?: string, value: string }} FilterChip
 */

/**
 * @typedef {Record<string, string | string[] | Array<{ paramKey: string, value: string }>>} FilterFormState
 */

/**
 * Build empty form state from search key definitions.
 * @param {Array<{ key: string, type?: string, multi?: boolean }>} searchKeys
 * @param {{ freeTextSearchKey?: string | null }} [options]
 * @returns {FilterFormState}
 */
export function emptyFilterForm(searchKeys, { freeTextSearchKey = null } = {}) {
  /** @type {FilterFormState} */
  const state = {};
  if (freeTextSearchKey) {
    state[freeTextSearchKey] = "";
  }
  for (const kd of searchKeys ?? []) {
    if (kd.type === "tag" || kd.multi) {
      state[kd.key] = [];
    } else if (kd.type === "param") {
      state[kd.key] = [];
    } else {
      state[kd.key] = "";
    }
  }
  return state;
}

/**
 * Hydrate form state from applied chips.
 * @param {FilterChip[]} chips
 * @param {Array<{ key: string, type?: string, multi?: boolean }>} searchKeys
 * @param {{ freeTextSearchKey?: string | null }} [options]
 * @returns {FilterFormState}
 */
export function chipsToFormState(chips, searchKeys, { freeTextSearchKey = null } = {}) {
  const state = emptyFilterForm(searchKeys, { freeTextSearchKey });
  if (!Array.isArray(chips)) return state;

  for (const chip of chips) {
    const key = chip?.key;
    const value = (chip?.value ?? "").trim();
    if (!key || !value) continue;

    if (freeTextSearchKey && key === freeTextSearchKey) {
      state[key] = value;
      continue;
    }

    const kd = searchKeys.find((k) => k.key === key);
    if (!kd) continue;

    if (kd.type === "param") {
      const paramKey = (chip.paramKey ?? "").trim();
      if (!paramKey) continue;
      const rows = /** @type {Array<{ paramKey: string, value: string }>} */ (state.param ?? []);
      if (!rows.some((r) => r.paramKey.toLowerCase() === paramKey.toLowerCase())) {
        rows.push({ paramKey, value });
      }
      state.param = rows;
      continue;
    }

    if (kd.type === "tag" || kd.multi) {
      const tags = /** @type {string[]} */ (state[key] ?? []);
      if (!tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
        tags.push(value);
      }
      state[key] = tags;
      continue;
    }

    state[key] = value;
  }

  return state;
}

/**
 * Convert form state to chip array for onSearch / API mapping.
 * @param {FilterFormState} formState
 * @param {Array<{ key: string, type?: string, multi?: boolean }>} searchKeys
 * @param {{ freeTextSearchKey?: string | null }} [options]
 * @returns {FilterChip[]}
 */
export function formStateToChips(formState, searchKeys, { freeTextSearchKey = null } = {}) {
  /** @type {FilterChip[]} */
  const chips = [];

  if (freeTextSearchKey) {
    const q = String(formState[freeTextSearchKey] ?? "").trim();
    if (q) chips.push({ key: freeTextSearchKey, value: q });
  }

  for (const kd of searchKeys ?? []) {
    const raw = formState[kd.key];
    if (raw == null) continue;

    if (kd.type === "param") {
      const rows = /** @type {Array<{ paramKey: string, value: string }>} */ (raw);
      for (const row of rows) {
        const paramKey = (row.paramKey ?? "").trim();
        const value = (row.value ?? "").trim();
        if (!paramKey || !value) continue;
        chips.push({ key: "param", paramKey, value });
      }
      continue;
    }

    if (kd.type === "tag" || kd.multi) {
      const values = /** @type {string[]} */ (raw);
      for (const value of values) {
        const trimmed = String(value ?? "").trim();
        if (trimmed) chips.push({ key: kd.key, value: trimmed });
      }
      continue;
    }

    const value = String(raw ?? "").trim();
    if (value) chips.push({ key: kd.key, value });
  }

  return chips;
}

/**
 * True when form has at least one active criterion.
 * @param {FilterFormState} formState
 * @param {Array<{ key: string, type?: string, multi?: boolean }>} searchKeys
 * @param {{ freeTextSearchKey?: string | null }} [options]
 */
export function hasActiveFilterCriteria(formState, searchKeys, { freeTextSearchKey = null } = {}) {
  return formStateToChips(formState, searchKeys, { freeTextSearchKey }).length > 0;
}
