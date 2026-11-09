/**
 * pipeline-sections.mjs — algorithm mirror of the core's `lib/pipeline-sections.mjs`
 * (#5520), so the web inbox finds the Pending heading in every language a mode
 * ships, not only English and Spanish (#5569).
 *
 * Plain .mjs (same pattern as the other web/src/lib/core mirrors) so node:test
 * and client bundles can import it without reaching outside the web root. The
 * SECTION_PAIRS table and the folding rule are kept in step with the core;
 * pipeline-sections-parity.test.mjs guards the two against drift.
 */

const SECTION_PAIRS = [
  ["Pending", "Processed"],
  ["Pendientes", "Procesadas"],
  ["Pendentes", "Processadas"],
  ["Offen", "Verarbeitet"],
  ["En attente", "Traitees"],
  ["In attesa", "Elaborati"],
  ["In afwachting", "Verwerkt"],
  ["Afventer", "Behandlede"],
  ["Oczekujące", "Przetworzone"],
  ["Bekleyenler", "İşlenenler"],
  ["Menunggu", "Diproses"],
  ["Ожидающие", "Обработанные"],
  ["Очікуючі", "Оброблені"],
  ["लंबित", "संसाधित"],
  ["대기", "처리 완료"],
];

// Accents and case are folded, so a hand-typed "Traitées" matches the
// "Traitees" that modes/fr writes.
const fold = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const KIND = new Map(SECTION_PAIRS.flatMap(([pending, processed]) => [
  [fold(pending), { kind: "pending", processed }],
  [fold(processed), { kind: "processed" }],
]));

/**
 * @param {string} line - One line of pipeline.md.
 * @returns {"pending"|"processed"|null} The section a `## ` heading opens, or null.
 */
export function sectionKind(line) {
  const m = /^##[ \t]+(.+?)[ \t]*\r?$/.exec(line);
  return m ? KIND.get(fold(m[1]))?.kind ?? null : null;
}

/**
 * @param {string} pendingLine - A line for which sectionKind() is "pending".
 * @returns {string} The Processed heading in the same language.
 */
export function processedHeadingFor(pendingLine) {
  const m = /^##[ \t]+(.+?)[ \t]*\r?$/.exec(pendingLine);
  return `## ${(m && KIND.get(fold(m[1]))?.processed) || "Processed"}`;
}
