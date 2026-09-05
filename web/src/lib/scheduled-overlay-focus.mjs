export function cycleFocusIndex(index, count, backwards = false) {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (backwards) return index <= 0 ? count - 1 : index - 1;
  return index >= count - 1 ? 0 : index + 1;
}
