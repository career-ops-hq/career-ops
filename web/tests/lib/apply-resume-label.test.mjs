import { test } from "node:test";
import assert from "node:assert/strict";
import { isResumeLabel } from "../../src/lib/apply/resume-label.mjs";

const RESUME = [
  "Resume", "Résumé / CV", "RÉSUMÉ", "Upload your CV", "Lebenslauf", "Currículum vitae",
  "Currículo", "Curriculum", "Резюме", "Życiorys (CV)", "Özgeçmiş", "履歴書", "職務経歴書",
  "上传简历", "上傳履歷", "이력서 첨부", "السيرة الذاتية", "रिज्यूमे अपलोड करें", "Riwayat hidup",
];
const NOT_RESUME = ["Cover letter", "Portfolio", "Anschreiben", "Lettre de motivation", "Carta de presentación", "Certificates", "Zeugnisse", "CVV"];

for (const label of RESUME) {
  test(`"${label}" is a résumé upload`, () => assert.equal(isResumeLabel(label), true));
}
for (const label of NOT_RESUME) {
  test(`"${label}" is left for the person`, () => assert.equal(isResumeLabel(label), false));
}
