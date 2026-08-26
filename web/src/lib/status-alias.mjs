// Status alias → canonical stage, mirroring `templates/states.yml`.
//
// Pure JS (no TS types) so it can be imported both by format.ts and by a
// `node --test` unit test, matching funnel-tiles.mjs / clean-chips.mjs /
// stream-parse.mjs.
//
// This map is a LITERAL rather than a read of states.yml because format.ts is
// node-free on purpose — it is imported by client components, so it cannot
// touch fs at runtime. The map has to ship in the bundle as data.
//
// Kept honest by tests/lib/status-alias.test.mjs, which loads states.yml and
// asserts every alias in it resolves here. A copy with nothing checking it is
// what #2249 fixed by hand for `Hired` and what drifted again as #2917.
//
// Entries marked `web-only` have no counterpart in states.yml; they predate it
// and are kept so this cannot regress an existing tracker. The sync is
// one-directional: states.yml is a floor, not a cap.

/** @type {Record<string, string>} */
export const STATUS_ALIAS = {
  // Evaluated — states.yml `evaluated`
  evaluada: "EVALUATED",
  condicional: "EVALUATED",
  hold: "EVALUATED",
  evaluar: "EVALUATED",
  verificar: "EVALUATED",
  "değerlendirildi": "EVALUATED",
  degerlendirildi: "EVALUATED",
  evaluado: "EVALUATED", // web-only: not in states.yml
  // Applied — states.yml `applied`
  aplicado: "APPLIED",
  enviada: "APPLIED",
  aplicada: "APPLIED",
  sent: "APPLIED",
  "başvuruldu": "APPLIED",
  basvuruldu: "APPLIED",
  // Responded — states.yml `responded`
  respondido: "RESPONDED",
  "yanıt verildi": "RESPONDED",
  "yanıt_verildi": "RESPONDED",
  "yanit verildi": "RESPONDED",
  yanit_verildi: "RESPONDED",
  respondida: "RESPONDED", // web-only: not in states.yml
  contestada: "RESPONDED", // web-only: not in states.yml
  // Interview — states.yml `interview`
  entrevista: "INTERVIEW",
  "mülakat": "INTERVIEW",
  mulakat: "INTERVIEW",
  // Offer — states.yml `offer`
  oferta: "OFFER",
  teklif: "OFFER",
  // Rejected — states.yml `rejected`
  rechazado: "REJECTED",
  rechazada: "REJECTED",
  reddedildi: "REJECTED",
  // Discarded — states.yml `discarded`
  descartado: "DISCARDED",
  descartada: "DISCARDED",
  cerrada: "DISCARDED",
  cancelada: "DISCARDED",
  "iptal edildi": "DISCARDED",
  iptal_edildi: "DISCARDED",
  "ıptal edildi": "DISCARDED",
  "ıptal_edildi": "DISCARDED",
  duplicado: "DISCARDED", // web-only: not in states.yml
  repost: "DISCARDED", // web-only: not in states.yml
  // SKIP — states.yml `skip`
  no_aplicar: "SKIP",
  "no aplicar": "SKIP",
  skip: "SKIP",
  monitor: "SKIP",
  "geo blocker": "SKIP",
  geo_blocker: "SKIP",
  "uygun değil": "SKIP",
  "uygun_değil": "SKIP",
  "uygun degil": "SKIP",
  uygun_degil: "SKIP",
  // Hired — states.yml `hired`
  contratado: "HIRED",
  contratada: "HIRED",
  hired: "HIRED",
  accepted: "HIRED",
  accept: "HIRED",
  "kabul edildi": "HIRED",
  kabul_edildi: "HIRED",
  "işe alındı": "HIRED",
  "ise alindi": "HIRED",
  "işe alindi": "HIRED",
};

/**
 * Fold raw status text to a lookup key.
 *
 * Mirrors foldStatusInput() in tracker-utils.mjs (#2705). The `\u0307` strip is
 * what makes a capitalised Turkish status resolve: JS lowercases `İ` to `i` +
 * U+0307 COMBINING DOT ABOVE, so "İşe alındı" keys as "i̇şe alındı" and misses
 * the "işe alındı" entry. Real tracker rows are capitalised, so without this
 * the alias table is only reachable by input that is already lowercase.
 *
 * NFKC and NOT NFD, deliberately: NFD decomposes precomposed letters too, so
 * the same strip would reach the dots of ż / ė / ġ and collapse Żubr onto
 * Zubr, Ėmė onto Eme, Ġenerali onto Generali.
 *
 * Markdown bold is stripped because AGENTS.md forbids it in the status field —
 * which is exactly why it turns up there.
 *
 * @param {string} s - Raw status text from the tracker.
 * @returns {string} Lookup key.
 */
function foldStatus(s) {
  return String(s ?? "")
    .replace(/\*\*/g, "")
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u0307/gu, "");
}

/**
 * Normalize a raw tracker status to a canonical stage token.
 *
 * Unknown input is passed through uppercased rather than rejected, so a status
 * this map has never seen still renders as itself. Consumers substring-test the
 * result, which is why an alias missing from the map above resolves to no stage
 * at all — see tests/lib/status-alias.test.mjs.
 *
 * @param {string} s - Raw status text from the tracker.
 * @returns {string} Canonical stage token, or the uppercased input.
 */
export function canonStatus(s) {
  const k = foldStatus(s);
  if (k === "" || k === "—" || k === "-") return "DISCARDED";
  return STATUS_ALIAS[k] ?? String(s ?? "").toUpperCase();
}
