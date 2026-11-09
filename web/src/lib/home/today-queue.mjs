function rank(item) {
  if (item?.kind === "follow-up" && item.due) return 0;
  if (item?.kind === "decision") return 1;
  if (item?.kind === "match") return 2;
  if (item?.kind === "follow-up") return 3;
  return 4;
}

/**
 * @template {{ kind?: string, due?: boolean }} T
 * @param {T[] | null | undefined} items
 * @returns {T[]}
 */
export function orderTodayQueue(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map((row) => row.item);
}
