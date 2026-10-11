import { forwardRef, useImperativeHandle } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTreeScrollContext } from "../contexts/TreeScrollContext";
import {
  FOLDER_ROW_ESTIMATE_PX,
  VIRTUAL_FOLDER_TREE_OVERSCAN,
} from "../constants/virtualFolderTree";
import { findFlatRowIndex } from "../utils/folderTreeFlat";
import FolderTreeRow from "./FolderTreeRow";

/**
 * Virtual folder list inside TreeScrollContainer.
 *
 * @typedef {{ scrollToDirectoryPath: (directoryPath: string, options?: { align?: string, behavior?: string }) => void }} VirtualizedFolderListHandle
 */

const VirtualizedFolderList = forwardRef(function VirtualizedFolderList(
  { flatRows, rowProps },
  ref,
) {
  const scrollContext = useTreeScrollContext();
  const scrollElementRef = scrollContext?.scrollElementRef;

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollElementRef?.current ?? null,
    estimateSize: () => FOLDER_ROW_ESTIMATE_PX,
    overscan: VIRTUAL_FOLDER_TREE_OVERSCAN,
    enabled: flatRows.length > 0,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToDirectoryPath(directoryPath, options = {}) {
        const index = findFlatRowIndex(flatRows, directoryPath);
        if (index >= 0) {
          virtualizer.scrollToIndex(index, {
            align: options.align ?? "auto",
            behavior: options.behavior ?? "auto",
          });
        }
      },
    }),
    [flatRows, virtualizer],
  );

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      role="list"
      className="relative m-0 w-full p-0"
      style={{ height: totalSize }}
    >
      {virtualItems.map((virtualRow) => {
        const row = flatRows[virtualRow.index];
        const rowKey =
          row.kind === "folder"
            ? row.node.directory_path ?? row.pathKey
            : `create:${row.parentPath}`;
        const measureRef = (el) => {
          if (el) virtualizer.measureElement(el);
        };
        return (
          <div
            key={rowKey}
            data-index={virtualRow.index}
            ref={measureRef}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <FolderTreeRow row={row} measureRef={null} virtualized {...rowProps} />
          </div>
        );
      })}
    </div>
  );
});

export default VirtualizedFolderList;
