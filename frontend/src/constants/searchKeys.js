/**
 * Search key definitions per context.
 * Each key has:
 *   - key: internal identifier (maps to API param)
 *   - label: display label shown to users
 *   - type: "text" (free input) | "enum" (single/multi select from options) | "tag" (multi-select, loaded from DB)
 *   - placeholder: input placeholder when this key is active
 *   - multi: if true, user can pick multiple values (comma-separated)
 *   - apiParam: the API query param this maps to (defaults to key)
 */

import { ASSIGNED_TO_ME, ASSIGNED_TO_ME_LABEL } from "./assignee";
import {
  TICKET_RELEASE_NONE,
  TICKET_RELEASE_NONE_LABEL,
} from "./ticketRelease";
import { TICKET_STATUS_OPTIONS } from "../utils/ticketStatus";

const APPROVE_STATUS_KEY = "approve_status";

const ASSIGNED_TO_SEARCH_KEY = {
  key: "assigned_to",
  label: "Assigned to",
  type: "user",
  placeholder: "All",
  multi: false,
  apiParam: "assigned_to",
  filterKey: "assigned_to",
  specialOptions: [{ value: ASSIGNED_TO_ME, label: ASSIGNED_TO_ME_LABEL }],
};

const PRIORITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const CASE_SEARCH_KEYS = [
  {
    key: "priority",
    label: "Priority",
    type: "enum",
    placeholder: "Select priority…",
    multi: false,
    apiParam: "priority",
    filterKey: "priorities",
    options: PRIORITY_OPTIONS,
  },
  {
    key: "approve_status",
    label: "Approve Status",
    type: "enum",
    placeholder: "Select status…",
    multi: false,
    apiParam: "approve_status",
    options: [
      { value: "draft", label: "Draft" },
      { value: "approved", label: "Approved" },
      { value: "rejected", label: "Rejected" },
    ],
  },
  {
    key: "updated_by",
    label: "Last Updated By",
    type: "user",
    placeholder: "All",
    multi: false,
    apiParam: "updated_by",
    filterKey: "updated_by",
  },
  ASSIGNED_TO_SEARCH_KEY,
  {
    key: "automated",
    label: "Automated",
    type: "enum",
    placeholder: "Select…",
    multi: false,
    apiParam: "automated",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
  {
    key: "param",
    label: "Custom field",
    type: "param",
    placeholder: "Select key…",
    multi: true,
  },
  {
    key: "tag",
    label: "Tag",
    type: "tag",
    placeholder: "Select tags…",
    multi: true,
    apiParam: "tag",
  },
];

export const RUN_SEARCH_KEYS = [
  {
    key: "result",
    label: "Result",
    type: "enum",
    placeholder: "Select result…",
    multi: false,
    apiParam: "result",
    options: [
      { value: "passed", label: "Passed" },
      { value: "failed", label: "Failed" },
      { value: "skipped", label: "Skipped" },
      { value: "pending", label: "Pending" },
    ],
  },
  {
    key: "priority",
    label: "Priority",
    type: "enum",
    placeholder: "Select priority…",
    multi: false,
    apiParam: "priority",
    filterKey: "priorities",
    options: PRIORITY_OPTIONS,
  },
  {
    key: "requirement_id",
    label: "Requirement ID",
    type: "enum",
    placeholder: "Select requirement…",
    multi: false,
    apiParam: "requirement_id",
    filterKey: "requirement_ids",
  },
  {
    key: "executed_by",
    label: "Executed By",
    type: "enum",
    placeholder: "Select executor…",
    multi: false,
    apiParam: "executed_by",
    filterKey: "executed_by",
  },
  {
    key: "automated",
    label: "Automated",
    type: "enum",
    placeholder: "Select…",
    multi: false,
    apiParam: "automated",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
  ASSIGNED_TO_SEARCH_KEY,
  {
    key: "tag",
    label: "Tag",
    type: "tag",
    placeholder: "Select tags…",
    multi: true,
    apiParam: "tag",
  },
];

export const TICKET_SEARCH_KEYS = [
  {
    key: "type",
    label: "Type",
    type: "enum",
    placeholder: "Select type…",
    multi: false,
    apiParam: "ticket_type",
    filterKey: "types",
    options: [
      { value: "bug", label: "Bug" },
      { value: "story", label: "Story" },
      { value: "task", label: "Task" },
      { value: "spike", label: "Spike" },
    ],
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    placeholder: "Select status…",
    multi: false,
    apiParam: "status",
    filterKey: "statuses",
    options: TICKET_STATUS_OPTIONS,
  },
  {
    key: "priority",
    label: "Priority",
    type: "enum",
    placeholder: "Select priority…",
    multi: false,
    apiParam: "priority",
    filterKey: "priorities",
    options: PRIORITY_OPTIONS,
  },
  ASSIGNED_TO_SEARCH_KEY,
  {
    key: "sprint",
    label: "Sprint",
    type: "enum",
    placeholder: "Select sprint…",
    multi: false,
    apiParam: "sprint",
    filterKey: "sprints",
  },
  {
    key: "release",
    label: "Release",
    type: "enum",
    placeholder: "Select release…",
    multi: false,
    apiParam: "release",
    filterKey: "releases",
    specialOptions: [{ value: TICKET_RELEASE_NONE, label: TICKET_RELEASE_NONE_LABEL }],
  },
  {
    key: "param",
    label: "Custom field",
    type: "param",
    placeholder: "Select key…",
    multi: true,
  },
  {
    key: "tag",
    label: "Tag",
    type: "tag",
    placeholder: "Select tags…",
    multi: true,
    apiParam: "tag",
  },
];

/** Case search keys; omits approve_status when review is disabled. */
export function caseSearchKeys(reviewEnabled = true) {
  if (reviewEnabled) return CASE_SEARCH_KEYS;
  return CASE_SEARCH_KEYS.filter((k) => k.key !== APPROVE_STATUS_KEY);
}

/** Run search keys for Test Run and Review run tab. */
export function runSearchKeys() {
  return RUN_SEARCH_KEYS;
}

export const RELEASE_SEARCH_KEYS = [];

/** Release search keys for Releases view (free-text only; project scope via Open Project). */
export function releaseSearchKeys() {
  return RELEASE_SEARCH_KEYS;
}

/** Ticket search keys for Tickets view. */
export function ticketSearchKeys() {
  return TICKET_SEARCH_KEYS;
}

export const WIKI_SEARCH_KEYS = [
  {
    key: "tag",
    label: "Tag",
    type: "tag",
    placeholder: "Select tags…",
    multi: true,
    apiParam: "tag",
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    placeholder: "Select status…",
    multi: false,
    apiParam: "status",
    options: [
      { value: "draft", label: "Draft" },
      { value: "published", label: "Published" },
      { value: "outdated", label: "Outdated" },
    ],
  },
];

/** Wiki search keys (free-text title/id only). */
export function wikiSearchKeys() {
  return WIKI_SEARCH_KEYS;
}
