import { useCallback, useRef } from "react";

/**
 * Ctrl/Cmd toggle and Shift range selection for flat case lists.
 *
 * @param {{
 *   multiSelectActive: boolean;
 *   caseSelectionConfig: {
 *     selectedPaths: Set<string>;
 *     onChange: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
 *     orderedPaths: string[];
 *   } | null;
 *   onSelectCase?: (row: object) => void;
 * }} options
 */
export function useCaseRowSelection({ multiSelectActive, caseSelectionConfig, onSelectCase }) {
  const selectionAnchorRef = useRef(null);

  const handleCaseRowClick = useCallback(
    (c, e) => {
      if (!multiSelectActive || !caseSelectionConfig) {
        onSelectCase?.(c);
        return;
      }
      const path = c.file_path;
      const order = caseSelectionConfig.orderedPaths;
      if (e.shiftKey && selectionAnchorRef.current && order.length) {
        const i1 = order.indexOf(selectionAnchorRef.current);
        const i2 = order.indexOf(path);
        if (i1 !== -1 && i2 !== -1) {
          const [a, b] = i1 <= i2 ? [i1, i2] : [i2, i1];
          caseSelectionConfig.onChange(new Set(order.slice(a, b + 1)));
          onSelectCase?.(c);
          e.preventDefault();
          return;
        }
      }
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        caseSelectionConfig.onChange((prev) => {
          const next = new Set(prev);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
        selectionAnchorRef.current = path;
        onSelectCase?.(c);
        return;
      }
      selectionAnchorRef.current = path;
      caseSelectionConfig.onChange(new Set([path]));
      onSelectCase?.(c);
    },
    [multiSelectActive, caseSelectionConfig, onSelectCase],
  );

  const prepareContextMenuSelection = useCallback(
    (c) => {
      if (!multiSelectActive || !caseSelectionConfig) return;
      const clicked = c?.file_path;
      const selected = caseSelectionConfig.selectedPaths;
      if (clicked && (!selected || selected.size === 0 || !selected.has(clicked))) {
        selectionAnchorRef.current = clicked;
        caseSelectionConfig.onChange(new Set([clicked]));
      }
    },
    [multiSelectActive, caseSelectionConfig],
  );

  return { handleCaseRowClick, prepareContextMenuSelection, selectionAnchorRef };
}
