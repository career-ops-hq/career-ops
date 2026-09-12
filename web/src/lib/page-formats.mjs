/**
 * page-formats.mjs — the page sizes generate-pdf.mjs accepts (#2185).
 *
 * A leaf module on purpose. Both the envelope parser (which validates the format
 * the agent declares) and the render pipeline (which passes it to
 * `generate-pdf.mjs --format=`) are CONSUMERS of this contract; neither owns it.
 * Keeping it here stops a pure parser from having to import the module that
 * orchestrates child processes just to learn two constants, and leaves no room
 * for an import cycle if the renderer ever needs the parser.
 *
 * No dependencies, so `node --test` and the core suite can both import it.
 */

/** Accepted `--format` values. */
export const PAGE_FORMATS = new Set(["a4", "letter"]);

/**
 * Fallback when no usable format is available.
 *
 * `letter`, because that is what the engine documents: modes/pdf.md's payload
 * table says `page_format` "Defaults to `letter`". Picking a4 here would make the
 * web disagree with the CLI about the same missing field — and would silently
 * change the page size of an existing render path, which #2185 never asked for.
 * The prompt still tells the agent to CHOOSE a4 unless the company is US/Canada;
 * this only applies when it declares nothing at all.
 */
export const DEFAULT_PAGE_FORMAT = "letter";
