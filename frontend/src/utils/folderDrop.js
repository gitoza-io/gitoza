/**
 * Hit-test folder drop row under pointer (works during pointer-driven drag; WKWebView often omits HTML5 dragover on folder rows).
 *
 * @param {number} clientX
 * @param {number} clientY
 * @returns {string | null}
 */
export function findFolderDropPathFromPoint(clientX, clientY) {
  if (typeof document.elementsFromPoint !== "function") return null;
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    const header = el?.closest?.("[data-folder-drop-header]");
    if (header) {
      const p = header.getAttribute("data-folder-drop-header");
      if (p) return p;
    }
    const container = el?.closest?.("[data-folder-drop-container]");
    if (container) {
      const p = container.getAttribute("data-folder-drop-container");
      if (p) return p;
    }
  }
  return null;
}
