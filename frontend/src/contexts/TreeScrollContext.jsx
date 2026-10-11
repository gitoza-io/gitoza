import { createContext, useContext, useRef } from "react";

const TreeScrollContext = createContext(null);

/**
 * @param {{ scrollElementRef: React.RefObject<HTMLElement | null> }} value
 */
export function TreeScrollProvider({ scrollElementRef, children }) {
  return (
    <TreeScrollContext.Provider value={{ scrollElementRef }}>
      {children}
    </TreeScrollContext.Provider>
  );
}

export function useTreeScrollContext() {
  return useContext(TreeScrollContext);
}

/**
 * Scroll container with overflow-y-auto that provides TreeScrollContext to descendants.
 */
export function TreeScrollContainer({ className, children, ...props }) {
  const scrollRef = useRef(null);
  return (
    <TreeScrollProvider scrollElementRef={scrollRef}>
      <div ref={scrollRef} className={className} {...props}>
        {children}
      </div>
    </TreeScrollProvider>
  );
}
