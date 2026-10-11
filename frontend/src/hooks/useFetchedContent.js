import { useEffect, useRef, useState } from "react";

/**
 * Fetches content when selection changes. Keeps previous content until new fetch completes
 * (no clearing → no full-screen loading flicker when switching items).
 * Same pattern as Test Repo: parent fetches, panel is presentational.
 *
 * @param {string | null} selectionKey - Stable key for current selection (e.g. file_path or "runId\u0000caseId"). When null, content is kept (so caller can show it as placeholder when switching types).
 * @param {() => Promise<any>} fetchContent - Function that fetches content for the current selection (no args; closes over selection).
 * @returns {[any, string | null]} [content, contentKey] - content is the fetched data; contentKey is the selectionKey this content is for (so caller can tell if content matches current selection).
 */
export function useFetchedContent(selectionKey, fetchContent) {
  const [state, setState] = useState({ content: null, contentKey: null });
  const lastKeyRef = useRef(selectionKey);
  const fetchContentRef = useRef(fetchContent);
  fetchContentRef.current = fetchContent;

  useEffect(() => {
    if (selectionKey == null || selectionKey === "") {
      lastKeyRef.current = null;
      return;
    }
    const key = selectionKey;
    lastKeyRef.current = key;
    fetchContentRef.current()
      .then((data) => {
        if (lastKeyRef.current === key) {
          setState({ content: data, contentKey: key });
        }
      })
      .catch(() => {
        if (lastKeyRef.current === key) {
          setState({ content: null, contentKey: key });
        }
      });
  }, [selectionKey]);

  return [state.content, state.contentKey];
}
