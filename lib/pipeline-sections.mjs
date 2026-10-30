/**
 * pipeline-sections.mjs — the Pending and Processed headings of data/pipeline.md.
 *
 * Each modes/<lang>/pipeline.md tells the agent to write these two sections in
 * its own language, and to keep the language an existing file already uses.
 * scan.mjs, sync-batch-input.mjs and reconcile-pipeline.mjs read and write the
 * same file, so they share this one table.
 */

const SECTION_PAIRS = [
  ['Pending', 'Processed'],
  ['Pendientes', 'Procesadas'],
  ['Pendentes', 'Processadas'],
  ['Offen', 'Verarbeitet'],
  ['En attente', 'Traitees'],
  ['In attesa', 'Elaborati'],
  ['In afwachting', 'Verwerkt'],
  ['Afventer', 'Behandlede'],
  ['Oczekujące', 'Przetworzone'],
  ['Bekleyenler', 'İşlenenler'],
  ['Menunggu', 'Diproses'],
  ['Ожидающие', 'Обработанные'],
  ['Очікуючі', 'Оброблені'],
  ['लंबित', 'संसाधित'],
  ['대기', '처리 완료'],
];

// Accents and case are folded, so a hand-typed "Traitées" matches the
// "Traitees" that modes/fr writes.
const fold = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const KIND = new Map(SECTION_PAIRS.flatMap(([pending, processed]) => [
  [fold(pending), { kind: 'pending', processed }],
  [fold(processed), { kind: 'processed' }],
]));

/**
 * @param {string} line - One line of pipeline.md.
 * @returns {'pending'|'processed'|null} The section a `## ` heading opens, or null.
 */
export function sectionKind(line) {
  const m = /^##[ \t]+(.+?)[ \t]*\r?$/.exec(line);
  return m ? KIND.get(fold(m[1]))?.kind ?? null : null;
}

/**
 * @param {string} pendingLine - A line for which sectionKind() is 'pending'.
 * @returns {string} The Processed heading in the same language.
 */
export function processedHeadingFor(pendingLine) {
  const m = /^##[ \t]+(.+?)[ \t]*\r?$/.exec(pendingLine);
  return `## ${(m && KIND.get(fold(m[1]))?.processed) || 'Processed'}`;
}
