/**
 * page-formats.mjs — the page sizes generate-pdf.mjs accepts (#2185).
 *
 * A leaf module on purpose. The render pipeline checks the size build-cv-html.mjs
 * reports against it before passing that size to `generate-pdf.mjs --format=`;
 * it is a CONSUMER of this contract, not its owner (lib/page-format.mjs is).
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
 */
export const DEFAULT_PAGE_FORMAT = "letter";
