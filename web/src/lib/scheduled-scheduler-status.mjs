export function isSchedulerStatusPayload(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && value.task && typeof value.task === "object" && !Array.isArray(value.task));
}
