import { createContext, useCallback, useContext, useRef } from "react";

const VirtualCaseListRegistryContext = createContext(null);

/**
 * Registry for per-folder virtual lists (RunCaseTree scroll-to-selected).
 */
export function VirtualCaseListRegistryProvider({ children }) {
  const registryRef = useRef(new Map());

  const register = useCallback((listId, api) => {
    if (!listId || !api) return () => {};
    registryRef.current.set(listId, api);
    return () => {
      registryRef.current.delete(listId);
    };
  }, []);

  const scrollToIndexInList = useCallback((listId, index, options) => {
    const tryScroll = () => {
      const api = registryRef.current.get(listId);
      if (api?.scrollToIndex) {
        api.scrollToIndex(index, options);
        return true;
      }
      return false;
    };
    if (tryScroll()) return;
    requestAnimationFrame(() => {
      tryScroll();
    });
  }, []);

  return (
    <VirtualCaseListRegistryContext.Provider value={{ register, scrollToIndexInList }}>
      {children}
    </VirtualCaseListRegistryContext.Provider>
  );
}

export function useVirtualCaseListRegistry() {
  return useContext(VirtualCaseListRegistryContext);
}
