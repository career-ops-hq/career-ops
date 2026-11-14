/**
 * A request the caller can correct: a bad name, a template that is not there, a
 * shipped template that cannot be changed. Routes answer a refusal with its own
 * message and status, and every other error (a filesystem failure, say, whose
 * message carries an absolute path) with a generic 500.
 */
export class TemplateRefusal extends Error {
  /** @param {string} message @param {number} [status] @param {{cause?: unknown}} [options] */
  constructor(message, status = 422, options = {}) {
    super(message, options);
    this.name = "TemplateRefusal";
    this.status = status;
  }
}

/**
 * What to throw for an error caught while validating a template. The core's own
 * validation errors are the caller's to correct, so they become a refusal. An
 * operating-system error (it has a syscall, and its message carries an absolute
 * path) is returned unchanged for the route to answer generically.
 * @param {unknown} e
 * @param {string} [prefix]
 */
export function refusalFrom(e, prefix = "") {
  if (e && typeof e === "object" && "syscall" in e) return e;
  return new TemplateRefusal(prefix + (e instanceof Error ? e.message : String(e)));
}
