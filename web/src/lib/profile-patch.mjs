/** Validate untrusted JSON before the profile route reads or writes user files.
 * @param {unknown} value
 * @returns {string | null} An actionable error, or null for a valid partial patch.
 */
export function profilePatchError(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "profile update must be an object";
  }
  for (const field of ["name", "email", "location", "currency", "remote"]) {
    if (field in value && typeof value[field] !== "string") {
      return `${field} must be a string`;
    }
  }
  if ("roles" in value && (!Array.isArray(value.roles) || value.roles.some((role) => typeof role !== "string"))) {
    return "roles must be an array of strings";
  }
  for (const field of ["compMin", "compMax"]) {
    if (field in value && (typeof value[field] !== "number" || !Number.isFinite(value[field]) || value[field] <= 0)) {
      return `${field} must be a positive finite number`;
    }
  }
  if (typeof value.compMin === "number" && typeof value.compMax === "number" && value.compMin > value.compMax) {
    return "compMin must not exceed compMax";
  }
  return null;
}
