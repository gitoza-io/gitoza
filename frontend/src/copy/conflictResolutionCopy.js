export const CONFLICT_PAGE_TITLE = "Review changes";

export const CONFLICT_CONTINUE_BUTTON = "Continue";
export const CONFLICT_SAVING_BUTTON = "Saving...";

export const CONFLICT_BANNER_FIRST =
  "Someone else updated the same items while you were working. For each item below, choose which version to keep.";

export const CONFLICT_BANNER_ADDITIONAL =
  "More overlapping changes were found. Review the items below and choose which version to keep.";

export const CONFLICT_SELECT_ITEM =
  "Select an item from the list to compare versions.";

export const CONFLICT_UNPARSEABLE_FILE =
  "We couldn't display the differences for this file. Cancel to go back, or try confirming again.";

export const CONFLICT_PER_FILE_HELPER =
  "You and someone else both changed this item. Choose the version to keep for each section.";

export const CONFLICT_SECTION_LABEL = (index) => `Section ${index + 1}`;

export const CONFLICT_KEEP_MINE = "Keep mine";
export const CONFLICT_KEEP_SHARED = "Keep shared version";

export const CONFLICT_COLUMN_YOURS = "Your changes";
export const CONFLICT_COLUMN_SHARED = "Shared changes";

export const CONFLICT_EMPTY_CONTENT = "(empty)";

export const CONFLICT_NO_CASES = "No cases need review.";
export const CONFLICT_NO_RUNS = "No test runs need review.";
export const CONFLICT_NO_TICKETS = "No tickets need review.";
export const CONFLICT_NO_WIKI = "No wiki pages need review.";
export const CONFLICT_NO_TEMPLATES = "No templates need review.";
export const CONFLICT_NO_CONFIG = "No project settings need review.";

export const CONFLICT_OVERLAPPING_FOUND = "Overlapping changes were found.";
export const CONFLICT_SAVE_FAILED = "Could not save your choices. Please try again.";
export const CONFLICT_CANCEL_FAILED = "Could not cancel. Please try again.";

export const CONFLICT_STRUCTURE_SECTION_LABEL = "What should happen to this item?";
export const CONFLICT_CONTENT_SECTION_LABEL = "Which content should we keep?";

export const CONFLICT_PROGRESS = (reviewed, total) => `${reviewed} of ${total} reviewed`;
export const CONFLICT_CHOICE_REQUIRED = "Select an option above to continue.";

const ENTITY_SINGULAR = {
  case: "case",
  run: "test run",
  ticket: "ticket",
  wiki: "wiki page",
  template: "template",
  config: "project settings",
  file: "file",
};

export const CONFLICT_MODIFY_DELETE_HEADLINE = (entity, sharedDeleted) =>
  sharedDeleted
    ? `Someone deleted this ${ENTITY_SINGULAR[entity] || "file"} while you were editing it.`
    : `You deleted this ${ENTITY_SINGULAR[entity] || "file"} while someone else edited it.`;

export const CONFLICT_MODIFY_DELETE_SUBCOPY =
  "Choose whether to keep your version or accept the shared change.";

export const CONFLICT_MODIFY_DELETE_MOVE_SUBCOPY =
  "Someone moved or deleted this item on the shared branch while you were editing. Choose how to reconcile the paths.";

export const CONFLICT_KEEP_MINE_ENTITY = (entity, hasCompanionPath) => {
  const label = ENTITY_SINGULAR[entity] || "file";
  if (hasCompanionPath) {
    return label === "project settings" ? "Keep my settings" : "Keep my version (move forward)";
  }
  return label === "project settings" ? "Keep my settings" : `Keep my ${label}`;
};

export const CONFLICT_KEEP_MINE_ENTITY_HELPER = (hasCompanionPath) =>
  hasCompanionPath
    ? "Accept the removal at the old path and keep your edited version."
    : "Your edited version on disk will be kept and synced.";

export const CONFLICT_KEEP_BOTH_ENTITY = (entity) => {
  const label = ENTITY_SINGULAR[entity] || "file";
  return label === "project settings" ? "Keep both settings" : `Keep both copies`;
};

export const CONFLICT_KEEP_BOTH_ENTITY_HELPER =
  "Keep your edited version at the old path and also keep the shared version at its new path.";

export const CONFLICT_KEEP_THEIRS_ENTITY = (entity, hasCompanionPath) => {
  const label = ENTITY_SINGULAR[entity] || "file";
  if (hasCompanionPath) {
    return label === "project settings"
      ? "Accept shared settings entirely"
      : "Accept shared move/delete entirely";
  }
  return label === "project settings" ? "Accept shared settings" : `Accept shared ${label}`;
};

export const CONFLICT_KEEP_THEIRS_ENTITY_HELPER = (hasCompanionPath) =>
  hasCompanionPath
    ? "Remove your old-path edits and keep only what is on the shared branch."
    : "Accept the shared version. Your local edits will be discarded.";

export const CONFLICT_DISK_RESOLUTION_HINT =
  "Resolution uses the version currently on disk at each path.";

export const CONFLICT_KEEP_ENTITY = (entity) => {
  const label = ENTITY_SINGULAR[entity] || "file";
  return label === "project settings" ? "Keep settings" : `Keep ${label}`;
};

export const CONFLICT_REMOVE_ENTITY = (entity) => {
  const label = ENTITY_SINGULAR[entity] || "file";
  return label === "project settings" ? "Remove settings" : `Remove ${label}`;
};

export const CONFLICT_KEEP_ENTITY_HELPER = "Your edited version will be kept and synced.";
export const CONFLICT_REMOVE_ENTITY_HELPER = "This item will be deleted. Your edits will be discarded.";
export const CONFLICT_REMOVE_PREVIEW = "This item will be removed from the project.";

export const CONFLICT_SIDEBAR_DELETE_BADGE = "Delete conflict";
export const CONFLICT_SIDEBAR_RENAME_BADGE = "Rename conflict";
export const CONFLICT_SIDEBAR_UNKNOWN_BADGE = "Unsupported";

export const CONFLICT_CONFIRM_ALL_THEIRS =
  "You are accepting the shared branch version for all delete conflicts.";
export const CONFLICT_CONFIRM_ALL_MINE =
  "You are keeping your versions for all delete conflicts.";
export const CONFLICT_CONFIRM_HAS_BOTH =
  "You are keeping both copies where the shared branch moved or deleted items.";
export const CONFLICT_CONFIRM_MIXED =
  "You are applying a mix of keep, clone, and accept-shared choices.";
export const CONFLICT_CONFIRM_DEFAULT = "Apply your conflict resolution choices and continue syncing?";

/** @deprecated use CONFLICT_CONFIRM_ALL_THEIRS */
export const CONFLICT_CONFIRM_ALL_REMOVE = CONFLICT_CONFIRM_ALL_THEIRS;
/** @deprecated use CONFLICT_CONFIRM_ALL_MINE */
export const CONFLICT_CONFIRM_ALL_KEEP = CONFLICT_CONFIRM_ALL_MINE;

export const CONFLICT_RENAME_HEADLINE = (entity) =>
  `You and someone else renamed this ${ENTITY_SINGULAR[entity] || "file"} to different names.`;

export const CONFLICT_RENAME_SUBCOPY = "Choose which path name to keep.";
export const CONFLICT_BULK_KEEP_YOUR_PATH = "Keep my path for all";
export const CONFLICT_BULK_KEEP_SHARED_PATH = "Keep shared path for all";
export const CONFLICT_BULK_KEEP_MINE_ALL = "Keep mine for all";

export const CONFLICT_KEEP_YOUR_PATH = "Keep your name";
export const CONFLICT_KEEP_SHARED_PATH = "Keep shared name";
export const CONFLICT_KEEP_YOUR_PATH_HELPER = "Your renamed path will be used.";
export const CONFLICT_KEEP_SHARED_PATH_HELPER = "The name already on the shared branch will be used.";
