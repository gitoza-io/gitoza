/**
 * Distance from the top of the scroll container to the top of a virtual list block.
 * Used as TanStack Virtual `scrollMargin` when multiple lists share one scroll parent.
 *
 * @param {HTMLElement | null | undefined} listEl
 * @param {HTMLElement | null | undefined} scrollEl
 * @returns {number}
 */
export function computeScrollMargin(listEl, scrollEl) {
  if (!listEl || !scrollEl) return 0;
  const listRect = listEl.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();
  return listRect.top - scrollRect.top + scrollEl.scrollTop;
}

/**
 * Estimated total height for a virtual case list before measurement.
 *
 * @param {number} caseCount
 * @param {number} rowEstimatePx
 * @returns {number}
 */
export function estimateVirtualListHeight(caseCount, rowEstimatePx) {
  if (!caseCount || caseCount <= 0) return 0;
  return caseCount * rowEstimatePx;
}

/**
 * Run a callback while preserving the scroll container's scrollTop.
 * Restores scrollTop on the next animation frame after the callback runs.
 *
 * @param {HTMLElement | null | undefined} scrollEl
 * @param {() => void} fn
 */
export function preserveScrollTop(scrollEl, fn) {
  if (!scrollEl) {
    fn();
    return;
  }
  const saved = scrollEl.scrollTop;
  fn();
  requestAnimationFrame(() => {
    scrollEl.scrollTop = saved;
  });
}

/**
 * @param {() => void} fn
 * @param {number} [waitMs]
 * @returns {() => void} debounced function with cancel()
 */
export function debounce(fn, waitMs = 50) {
  let timeoutId = null;
  const debounced = () => {
    if (timeoutId != null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn();
    }, waitMs);
  };
  debounced.cancel = () => {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  return debounced;
}
