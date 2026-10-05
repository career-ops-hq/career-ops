export function runStatusTone(state) {
  if (state === "success") return "success";
  if (state === "failed") return "failed";
  return "neutral";
}
