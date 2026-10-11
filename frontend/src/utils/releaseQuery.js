/**
 * Convert SearchPanel chips to list_releases query params.
 * @param {Array<{ key: string, value: string }>} chips
 * @returns {Record<string, unknown>}
 */
export function chipsToReleaseQueryParams(chips) {
  const params = {};
  for (const chip of chips ?? []) {
    if (!chip?.key || chip.value == null || chip.value === "") continue;
    if (chip.key === "q") {
      params.search = chip.value;
    } else if (chip.key === "project") {
      if (chip.value === "__none__") {
        params.project_empty = true;
      } else {
        params.project = chip.value;
      }
    } else if (chip.key === "status") {
      params.status = chip.value;
    }
  }
  return params;
}
