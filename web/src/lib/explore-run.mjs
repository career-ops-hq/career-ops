export function createRunOwner() {
  let current = 0;
  return {
    start() {
      current += 1;
      return current;
    },
    invalidate() {
      current += 1;
    },
    owns(token) {
      return token === current;
    },
  };
}
