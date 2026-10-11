import { getTickets } from "../services/api";

const DEFAULT_PAGE_SIZE = 200;

/**
 * Map SearchPanel chips to list_tickets API query params.
 * @param {Array<{ key: string, value: string }>} chips
 * @returns {object}
 */
export function chipsToTicketQueryParams(chips) {
  if (!Array.isArray(chips) || chips.length === 0) return {};

  const params = {};
  const freeTextParts = [];

  for (const chip of chips) {
    const key = chip?.key;
    const value = (chip?.value ?? "").trim();
    if (!key || !value) continue;

    switch (key) {
      case "q":
        freeTextParts.push(value);
        break;
      case "tag":
        params.tag = value;
        break;
      case "status":
        params.status = value;
        break;
      case "priority":
        params.priority = value;
        break;
      case "type":
        params.ticket_type = value;
        break;
      case "assigned_to":
        params.assigned_to = value;
        break;
      case "sprint":
        params.sprint = value;
        break;
      case "release":
        params.release = value;
        break;
      case "param": {
        const paramKey = (chip.paramKey ?? "").trim();
        if (!paramKey) break;
        if (!params.param_filters) params.param_filters = [];
        params.param_filters.push({ key: paramKey, value });
        break;
      }
      default: {
        // Frontmatter custom fields (param-field chips): key is the param name
        if (!params.param_filters) params.param_filters = [];
        params.param_filters.push({ key, value });
        break;
      }
    }
  }

  if (params.param_filters?.length) {
    params.param_filters = JSON.stringify(params.param_filters);
  } else {
    delete params.param_filters;
  }

  if (freeTextParts.length > 0) {
    params.search = freeTextParts.join(" ");
  }
  return params;
}

/**
 * Fetch one page of tickets.
 * @param {string|null} repoSlug
 * @param {object} params
 * @param {{ limit?: number, offset?: number }} [options]
 */
export async function fetchTicketWindow(
  repoSlug,
  params = {},
  { limit = DEFAULT_PAGE_SIZE, offset = 0 } = {},
) {
  if (!repoSlug) return { items: [], total: 0 };
  const res = await getTickets(repoSlug, {
    ...params,
    limit,
    offset,
  });
  const items = Array.isArray(res?.items) ? res.items : [];
  const total = typeof res?.total === "number" ? res.total : items.length;
  return { items, total };
}
