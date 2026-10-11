/**
 * Default GFM pipe table for Case “Insert action-expectation table”.
 * Shared by CaseEditorPanel insert and visual Markdown round-trip tests.
 */
export const ACTION_EXPECTATION_TABLE_MARKDOWN = [
  "| # | Action | Expected result |",
  "|---|--------|-----------------|",
  "| 1 | | |",
  "| 2 | | |",
  "| 3 | | |",
].join("\n");

/**
 * Snippet to insert at the cursor (leading/trailing newlines for separation).
 * @returns {string}
 */
export function actionExpectationTableSnippet() {
  return `\n${ACTION_EXPECTATION_TABLE_MARKDOWN}\n`;
}
