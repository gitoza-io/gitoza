/**
 * Normalize case ↔ ticket requirement links from API or legacy payloads.
 * @param {object | string | string[] | null | undefined} source
 * @returns {string[]}
 */
export function normalizeRequirementIds(source) {
  if (source == null || source === "") return [];
  if (Array.isArray(source)) {
    return uniqueIds(source);
  }
  if (typeof source === "string") {
    return uniqueIds(source.split(","));
  }
  if (typeof source === "object") {
    if (Array.isArray(source.requirement_ids)) {
      return uniqueIds(source.requirement_ids);
    }
    if (Array.isArray(source.requirementIds)) {
      return uniqueIds(source.requirementIds);
    }
    const legacy =
      source.requirement_id ?? source.requirementId ?? source.requirement ?? source.requirement_ticket;
    if (Array.isArray(legacy)) return uniqueIds(legacy);
    if (legacy != null && String(legacy).trim() !== "") {
      return uniqueIds(String(legacy).split(","));
    }
  }
  return [];
}

function uniqueIds(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/** Join ids for CSV / PDF display. */
export function joinRequirementIds(ids) {
  return normalizeRequirementIds(ids).join(", ");
}

/**
 * Union existing run covers with requirement ids from run cases (deduped).
 * @param {string[]|null|undefined} existingIds
 * @param {Array<object|string|string[]|null|undefined>|null|undefined} cases
 * @returns {string[]}
 */
export function mergeRunCoversFromCases(existingIds, cases) {
  const fromCases = [];
  for (const c of Array.isArray(cases) ? cases : []) {
    fromCases.push(...normalizeRequirementIds(c));
  }
  return normalizeRequirementIds([...(existingIds ?? []), ...fromCases]);
}

/**
 * When run-case snapshots lack requirement_ids, load them from live case details.
 * @param {Array<object>|null|undefined} cases
 * @param {(filePath: string) => Promise<object|null|undefined>} getDetail
 * @returns {Promise<object[]>}
 */
export async function enrichCasesRequirementIdsFromLive(cases, getDetail) {
  const list = Array.isArray(cases) ? cases : [];
  if (typeof getDetail !== "function") return list;
  return Promise.all(
    list.map(async (c) => {
      if (normalizeRequirementIds(c).length > 0) return c;
      const fp = typeof c?.file_path === "string" ? c.file_path.trim() : "";
      if (!fp) return c;
      try {
        const detail = await getDetail(fp);
        const ids = normalizeRequirementIds(detail);
        if (!ids.length) return c;
        return { ...c, requirement_ids: ids };
      } catch {
        return c;
      }
    }),
  );
}

