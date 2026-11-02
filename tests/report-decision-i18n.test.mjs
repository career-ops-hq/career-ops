import { pass, fail, warn, ROOT } from './helpers.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

console.log('\nreports: localized decision header');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function check(name, fn) {
  try {
    const problem = fn();
    if (problem) fail(`${name}: ${problem}`);
    else pass(name);
  } catch (err) {
    fail(`${name}: ${err.message}`);
  }
}

const LOCALES = [
  { file: 'modes/ar/fursah.md', score: '**Score:** {X/5}', decision: '**القرار:** {تقدّم | فكّر | ابحث أولاً | تجاوز}', lede: '{جملة `## القرار (lead)` منسوخة حرفياً}', apply: 'تقدّم' },
  { file: 'modes/da/oferta.md', score: '**Score:** {X/5}', decision: '**Beslutning:** {Søg | Overvej | Undersøg først | Spring over}', lede: '{sætningen om at søge, kopieret ordret}', apply: 'Søg' },
  { file: 'modes/de/angebot.md', score: '**Score:** {X/5}', decision: '**Entscheidung:** {Bewerben | Prüfen | Zuerst recherchieren | Überspringen}', lede: '{der Bewerbungssatz, wortgleich kopiert}', apply: 'Bewerben' },
  { file: 'modes/es/oferta.md', score: '**Score:** {X/5}', decision: '**Decisión:** {Presentarse | Valorar | Investigar primero | Descartar}', lede: '{la frase de `## Veredicto (lead)`, copiada tal cual}', apply: 'Presentarse' },
  { file: 'modes/fr/offre.md', score: '**Score:** {X/5}', decision: '**Décision:** {Postuler | Envisager | Chercher d\'abord | Passer}', lede: '{la phrase postuler ou non, copiée telle quelle}', apply: 'Postuler' },
  { file: 'modes/hi/naukri.md', score: '**Score:** {X/5}', decision: '**निर्णय:** {आवेदन करें | विचार करें | पहले जाँचें | छोड़ें}', lede: '{आवेदन वाला वाक्य, ज्यों का त्यों}', apply: 'आवेदन करें' },
  { file: 'modes/id/lowongan.md', score: '**Score:** {X/5}', decision: '**Keputusan:** {Lamar | Pertimbangkan | Teliti dulu | Lewati}', lede: '{kalimat lamar atau tidak, disalin apa adanya}', apply: 'Lamar' },
  { file: 'modes/it/annuncio.md', score: '**Punteggio:** {X/5}', decision: '**Decisione:** {Candidarsi | Valutare | Approfondire prima | Scartare}', lede: '{la frase candidarsi o no, copiata parola per parola}', apply: 'Candidarsi' },
  { file: 'modes/ja/kyujin.md', score: '**Score:** {X/5}', decision: '**決定:** {応募する | 検討する | 先に調べる | 見送る}', lede: '{`## 判定 (lead)` の一文をそのまま写す}', apply: '応募する' },
  { file: 'modes/ko/gonggo.md', score: '**Score:** {X/5}', decision: '**결정:** {지원 | 검토 | 먼저 조사 | 건너뛰기}', lede: '{지원 여부를 한 문장으로, 그대로 복사}', apply: '지원' },
  { file: 'modes/nl/vacature.md', score: '**Score:** {X/5}', decision: '**Beslissing:** {Solliciteren | Overwegen | Eerst onderzoeken | Overslaan}', lede: '{de zin over wel of niet solliciteren, woordelijk gekopieerd}', apply: 'Solliciteren' },
  { file: 'modes/pl/oferta.md', score: '**Score:** {X/5}', decision: '**Decyzja:** {Aplikuj | Rozważ | Najpierw sprawdź | Pomiń}', lede: '{zdanie o aplikacji, skopiowane słowo w słowo}', apply: 'Aplikuj' },
  { file: 'modes/pt/oferta.md', score: '**Score:** {X/5}', decision: '**Decisão:** {Candidatar | Considerar | Pesquisar primeiro | Não candidatar}', lede: '{a frase de candidatar ou não, copiada palavra por palavra}', apply: 'Candidatar' },
  { file: 'modes/ru/oferta.md', score: '**Score:** {X/5}', decision: '**Решение:** {Откликнуться | Рассмотреть | Сначала изучить | Пропустить}', lede: '{предложение из `## Вердикт (lead)`, дословно}', apply: 'Откликнуться' },
  { file: 'modes/tr/is-ilani.md', score: '**Puan:** {X.X}/5', decision: '**Karar:** {Başvur | Değerlendir | Önce araştır | Geç}', lede: '{`## Karar (lead)` cümlesi, kelimesi kelimesine}', apply: 'Başvur' },
  { file: 'modes/ua/oferta.md', score: '**Бал:** {X/5}', decision: '**Рішення:** {Відгукнутися | Розглянути | Спочатку дослідити | Пропустити}', lede: '{речення про відгук, дослівно}', apply: 'Відгукнутися' },
  { file: 'modes/vi/tuyen-dung.md', score: '**Score:** {X/5}', decision: '**Quyết định:** {Nộp hồ sơ | Cân nhắc | Tìm hiểu trước | Bỏ qua}', lede: '{câu của `## Kết luận (lead)`, chép nguyên văn}', apply: 'Nộp hồ sơ' },
  { file: 'modes/zh/oferta.md', score: '**Score:** {X/5}', decision: '**决定:** {申请 | 考虑 | 先调研 | 跳过}', lede: '{`## 结论 (lead)` 的那一句，逐字复制}', apply: '申请' },
  { file: 'modes/zh-TW/oferta.md', score: '**Score:** {X/5}', decision: '**決定:** {應徵 | 考慮 | 先調查 | 略過}', lede: '{`## 結論 (lead)` 的那一句，逐字複製}', apply: '應徵' },
];

function headerAfterScore(text, scoreLine) {
  const at = text.indexOf(scoreLine);
  if (at < 0) return null;
  const from = text.slice(at);
  const end = from.indexOf('\n---');
  return end < 0 ? null : from.slice(0, end);
}

for (const { file, score: scoreLine, decision: decisionLine, lede, apply: applyWord } of LOCALES) {
  check(`${file} puts a translated decision under the score`, () => {
    const header = headerAfterScore(read(file), scoreLine);
    if (!header) return `score line not found: ${scoreLine}`;
    const lines = header.split('\n');
    if (lines[1] !== decisionLine) return `line after score is ${JSON.stringify(lines[1])}`;
    if (!lines.includes(lede)) return `lede missing: ${lede}`;
    if (/verdict\s*:/i.test(header)) return 'header contains Verdict:';
    const label = decisionLine.match(/^\*\*(.+):\*\*/)[1];
    if (/verdict/i.test(label)) return `label ${label} collides with VERDICT`;
    if (!decisionLine.includes(applyWord)) return 'apply word missing from the decision line';
    return null;
  });
}

const headerMod = join(ROOT, 'web', 'src', 'lib', 'report-header.mjs');
if (!existsSync(join(ROOT, 'web', 'src'))) {
  warn('web/ not present in this checkout — skipping localized decision parser checks');
} else if (!existsSync(headerMod)) {
  fail('web/ exists but web/src/lib/report-header.mjs is missing — the decision parser cannot be checked (moved?)');
} else {
  const { readReport } = await import(pathToFileURL(headerMod).href);

  check('a translated header reads as Decision', () => {
    const report = `# Evaluation: Example Labs — Researcher

**Score:** 3.4/5
**Entscheidung:** Bewerben
**URL:** https://jobs.example/researcher

---

Example Labs is a fictional employer.
`;
    const fields = readReport(report).fields;
    const decision = fields.find((f) => f.label === 'Decision');
    if (!decision || decision.value !== 'Bewerben') return JSON.stringify(fields);
    const score = fields.find((f) => f.label === 'Score');
    if (!score || score.value !== '3.4/5') return JSON.stringify(fields);
    return null;
  });

  check('English Decision and a legacy Date alias still resolve', () => {
    const report = `# Evaluation: Example Labs — Researcher

**Fecha:** 2026-10-18
**Decision:** Research first

---
`;
    const fields = readReport(report).fields;
    const decision = fields.find((f) => f.label === 'Decision');
    const date = fields.find((f) => f.label === 'Date');
    if (!decision || decision.value !== 'Research first') return JSON.stringify(fields);
    if (!date || date.value !== '2026-10-18') return JSON.stringify(fields);
    return null;
  });

  check('prototype names are not header fields', () => {
    const report = `# Evaluation: Example Labs — Researcher

**constructor:** Apply
**__proto__:** Skip
**toString:** Consider

---
`;
    const fields = readReport(report).fields;
    if (fields.length !== 0) return JSON.stringify(fields.map((f) => String(f.label)));
    return null;
  });

  check('a Verdict label is not a decision', () => {
    const report = `# Evaluation: Example Labs — Researcher

**Verdict:** Apply
**Score:** 3.4/5

---
`;
    const fields = readReport(report).fields;
    if (fields.some((f) => f.label === 'Decision')) return JSON.stringify(fields);
    return null;
  });

  for (const { file, decision: decisionLine, apply: applyWord } of LOCALES) {
    const label = decisionLine.match(/^\*\*(.+):\*\*/)[1];
    check(`${file} parser reads ${label}`, () => {
      const report = `# Evaluation: Example Labs — Researcher

**${label}:** ${applyWord}
**URL:** https://jobs.example/researcher

---
`;
      const decision = readReport(report).fields.find((f) => f.label === 'Decision');
      if (!decision || decision.value !== applyWord) return JSON.stringify(readReport(report).fields);
      return null;
    });
  }
}
