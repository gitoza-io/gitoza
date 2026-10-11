/**
 * After a tree/list refresh, decide what to do with the open detail panel.
 *
 * @param {{ stillThere: boolean, isEditing: boolean }} args
 * @returns {"clear" | "apply" | "skip"}
 */
export function shouldApplyRefreshedDetail({ stillThere, isEditing }) {
  if (!stillThere) return "clear";
  if (isEditing) return "skip";
  return "apply";
}
