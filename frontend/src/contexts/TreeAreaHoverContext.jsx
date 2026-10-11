import { createContext, useContext, useState } from "react";

const TreeAreaHoverContext = createContext({ hovered: true });

/**
 * Use this inside TreeAreaHoverProvider to know if the mouse is over the tree area.
 * When outside the provider, defaults to true so guide lines still show.
 */
export function useTreeAreaHover() {
  return useContext(TreeAreaHoverContext).hovered;
}

/**
 * Wrap the tree area (e.g. the aside in TreeContentLayout); tracks mouse enter/leave
 * so vertical guide lines can be shown only when the pointer is over the tree.
 */
export function TreeAreaHoverProvider({ children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <TreeAreaHoverContext.Provider value={{ hovered }}>
      <div
        className="flex h-full min-h-0 flex-1 flex-col"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {children}
      </div>
    </TreeAreaHoverContext.Provider>
  );
}
