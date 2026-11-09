// Validation before saving source selections. Existing jobs without explicit
// source changes retain their historical fallback; a new edited selection may
// never silently turn into the broad default ATS sweep.
export function validateScheduledSelection(engine, filters, rawFilters) {
  if (rawFilters !== undefined && (!rawFilters || typeof rawFilters !== "object" || Array.isArray(rawFilters))) {
    throw new Error("Choose valid search filters.");
  }
  if (rawFilters?.websiteIds !== undefined) {
    if (!Array.isArray(rawFilters.websiteIds) || rawFilters.websiteIds.length > 20
      || rawFilters.websiteIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))) {
      throw new Error("Choose valid saved websites.");
    }
  }
  if (rawFilters?.ats !== undefined && (!Array.isArray(rawFilters.ats)
      || rawFilters.ats.some((id) => typeof id !== "string" || !["greenhouse", "lever", "ashby", "workday"].includes(id.toLowerCase())))) {
    throw new Error("Choose valid ATS sources.");
  }
  const sourceEdited = rawFilters && (Object.hasOwn(rawFilters, "ats") || Object.hasOwn(rawFilters, "websiteIds"));
  if (engine === "full" && sourceEdited && !(filters.ats || []).length && !(filters.websiteIds || []).length) {
    throw new Error("Select an ATS source or a saved website.");
  }
}
