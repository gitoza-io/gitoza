/**
 * Merge `next` into `prev` order: keep existing keys in prev order (with updated
 * objects from next), drop missing keys, prepend keys only present in next.
 *
 * @template T
 * @param {T[]|null|undefined} prev
 * @param {T[]|null|undefined} next
 * @param {(item: T) => string|null|undefined} keyFn
 * @returns {T[]}
 */
export function mergeListPreserveOrder(prev, next, keyFn) {
  const prevList = Array.isArray(prev) ? prev : [];
  const nextList = Array.isArray(next) ? next : [];
  if (typeof keyFn !== "function") return nextList.slice();

  const nextByKey = new Map();
  for (const item of nextList) {
    const key = keyFn(item);
    if (key == null || key === "") continue;
    nextByKey.set(key, item);
  }

  const seen = new Set();
  const kept = [];
  for (const item of prevList) {
    const key = keyFn(item);
    if (key == null || key === "") continue;
    const updated = nextByKey.get(key);
    if (updated === undefined) continue;
    kept.push(updated);
    seen.add(key);
  }

  const newcomers = [];
  for (const item of nextList) {
    const key = keyFn(item);
    if (key == null || key === "") continue;
    if (seen.has(key)) continue;
    newcomers.push(item);
    seen.add(key);
  }

  return [...newcomers, ...kept];
}
