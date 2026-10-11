import { useCallback, useRef, useState } from "react";
import { findFolderDropPathFromPoint } from "../utils/folderDrop";
import { suppressClickAfterPointerUp } from "../utils/suppressClickAfterPointerUp";

/**
 * Pointer-driven case drag onto folder rows (WKWebView / Tauri).
 *
 * @param {{
 *   multiSelectActive: boolean;
 *   caseSelectionConfig: {
 *     onMoveCasesToFolder?: (filePaths: string[], targetFolderPath: string) => Promise<void>;
 *   } | null;
 * }} options
 */
export function useCasePointerDrag({ multiSelectActive, caseSelectionConfig }) {
  const [pointerDragUI, setPointerDragUI] = useState(null);
  const [dragOverFolderPath, setDragOverFolderPath] = useState(null);
  // Last non-null hit-test result; used as a fallback if pointerup hit-testing misses.
  const dragOverFolderPathRef = useRef(null);
  const pointerDragPathsRef = useRef(null);
  const pointerSessionActiveRef = useRef(false);

  const endCaseDrag = useCallback(() => {
    setDragOverFolderPath(null);
    dragOverFolderPathRef.current = null;
    setPointerDragUI(null);
    document.body.style.cursor = "";
  }, []);

  const applyMoveCasesToFolder = useCallback(
    async (paths, targetFolderPath) => {
      if (
        !caseSelectionConfig?.onMoveCasesToFolder ||
        !targetFolderPath ||
        !Array.isArray(paths) ||
        paths.length === 0
      ) {
        return;
      }
      const filtered = paths.filter((p) => {
        if (typeof p !== "string" || !p.includes("/")) return false;
        const parent = p.slice(0, p.lastIndexOf("/"));
        return parent !== targetFolderPath;
      });
      if (filtered.length === 0) return;
      await caseSelectionConfig.onMoveCasesToFolder(filtered, targetFolderPath);
    },
    [caseSelectionConfig],
  );

  const handleCaseRowPointerDown = useCallback(
    (e, dragMeta) => {
      if (e.button !== 0 || !multiSelectActive || !caseSelectionConfig || pointerSessionActiveRef.current) {
        return;
      }
      if (e.target?.closest?.('input[type="checkbox"]')) return;

      const dragPaths = dragMeta.paths;
      const startX = e.clientX;
      const startY = e.clientY;
      const rowEl = e.currentTarget;
      let slopBroken = false;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!slopBroken) {
          if (dx * dx + dy * dy < 36) return;
          slopBroken = true;
          pointerSessionActiveRef.current = true;
          try {
            rowEl.setPointerCapture(ev.pointerId);
          } catch (_) {}
          window.getSelection?.()?.removeAllRanges?.();
          pointerDragPathsRef.current = dragPaths;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
        ev.preventDefault();
        setPointerDragUI({
          x: ev.clientX,
          y: ev.clientY,
          paths: dragPaths,
          summaryLine: dragMeta.summaryLine,
          detailLine: dragMeta.detailLine,
        });
        const nextFolderPath = findFolderDropPathFromPoint(ev.clientX, ev.clientY);
        setDragOverFolderPath(nextFolderPath);
        dragOverFolderPathRef.current = nextFolderPath;
      };

      const finish = async (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        document.body.style.userSelect = "";
        if (!slopBroken) return;
        try {
          if (rowEl.hasPointerCapture?.(ev.pointerId)) rowEl.releasePointerCapture(ev.pointerId);
        } catch (_) {}

        // Some WebViews/Tauri events have pointerup coordinates that miss the row
        // (even though pointermove hit-test succeeded). Fall back to the last
        // highlighted folder path so drop still works.
        const targetPath =
          findFolderDropPathFromPoint(ev.clientX, ev.clientY) || dragOverFolderPathRef.current;
        const pathsToMove = pointerDragPathsRef.current;
        pointerDragPathsRef.current = null;
        pointerSessionActiveRef.current = false;
        endCaseDrag();

        suppressClickAfterPointerUp();
        if (targetPath && pathsToMove?.length) {
          await applyMoveCasesToFolder(pathsToMove, targetPath);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [multiSelectActive, caseSelectionConfig, applyMoveCasesToFolder, endCaseDrag],
  );

  return {
    pointerDragUI,
    dragOverFolderPath,
    draggingSourcePaths: pointerDragUI?.paths ?? null,
    handleCaseRowPointerDown,
  };
}
