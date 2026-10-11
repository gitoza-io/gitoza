/**
 * Suppress the ghost click that browsers may dispatch after pointerup during custom drag.
 * Registers synchronously on pointerup and removes on the next macrotask.
 */
export function suppressClickAfterPointerUp() {
  const suppressClick = (ce) => {
    ce.preventDefault();
    ce.stopPropagation();
  };
  document.addEventListener("click", suppressClick, true);
  setTimeout(() => {
    document.removeEventListener("click", suppressClick, true);
  }, 0);
}
