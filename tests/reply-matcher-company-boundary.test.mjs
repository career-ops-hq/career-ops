// tests/reply-matcher-company-boundary.test.mjs — what may count as a
// company-name signal when matching a reply to an application.
//
// `reply-matcher.mjs` shipped with no test file at all, and the company check
// is the load-bearing one: `isCompanyMatch` is worth 2 points, it is the
// corroboration that lets a PARTIAL role match count (#2671), and paired with a
// post-application keyword it raises the verdict to `high`. reply-watch then
// proposes tracker updates from that verdict.
//
// Two ways it fired on text that names no company at all:
//
//   1. `?` is the DOCUMENTED placeholder for an unknown end employer (#1596,
//      AGENTS.md). checkCompanyMatch opened with a bare `text.includes(company)`,
//      so any reply containing a question mark "matched" it — and replies ask
//      questions. Measured: a mail from an unrelated firm reading "Seriez-vous
//      disponible pour un interview ?" attached itself to the `?` row with
//      confidence `high`.
//   2. The length floor (`cNorm.length > 2`) guarded only the third, normalized
//      check. The two substring checks above it had none and no word boundary,
//      so company `HP` matched the word `PHP`.
//
// The fix must not cost the short names that are real: HP, 3M and IBM all have
// to keep matching when they appear as words.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nreply-matcher.mjs — a company signal must name a company');

try {
  const { checkCompanyMatch, matchCandidates } = await import(
    pathToFileURL(join(ROOT, 'reply-matcher.mjs')).href
  );

  const check = (label, actual, expected) => {
    if (actual === expected) pass(label);
    else fail(`${label} => ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };

  // ── 1. Placeholders are not names ──
  check('"?" does not match a question mark',
    checkCompanyMatch('Seriez-vous disponible pour un entretien ?', '?'), false);
  check('"?" does not match text without one',
    checkCompanyMatch('Merci de votre candidature.', '?'), false);
  // The tracker uses these same sentinels for "no data" in other columns, and a
  // hand-edited row can carry one in Company too.
  check('an em-dash placeholder does not match',
    checkCompanyMatch('Nous revenons vers vous — bonne journée', '—'), false);
  check('a hyphen placeholder does not match',
    checkCompanyMatch('Poste back-end senior', '-'), false);

  // ── 2. A short name needs a word boundary ──
  check('"HP" does not match inside "PHP"',
    checkCompanyMatch('Nous recherchons un profil PHP senior', 'HP'), false);
  check('"#" alone does not match "C#"',
    checkCompanyMatch('Poste en C# et .NET', '#'), false);

  // ── Guards: the short names that are real must keep working ──
  check('"HP" still matches when it stands as a word',
    checkCompanyMatch('Bonjour, HP Enterprise vous remercie', 'HP'), true);
  check('"3M" still matches',
    checkCompanyMatch('Votre candidature chez 3M a bien ete recue', '3M'), true);
  check('"IBM" still matches',
    checkCompanyMatch('IBM France — suite de votre candidature', 'IBM'), true);
  check('a normal company name still matches',
    checkCompanyMatch('Bonjour, suite a votre candidature chez Acme', 'Acme'), true);
  check('a normal company name still fails when absent',
    checkCompanyMatch('Rien a voir avec cette societe', 'Acme'), false);
  check('case-insensitive matching survives',
    checkCompanyMatch('bienvenue chez ACME corp', 'Acme'), true);

  // ── 2b. Scripts with no word separators keep the substring path ──
  // A word boundary can never hold in CJK: every neighbouring character is a
  // letter, so requiring one refuses names that are plainly present. Two-
  // character company names are the norm there (腾讯 Tencent, 京東 JD), and this
  // file already carries normalizeChinese() for exactly that case — a short-name
  // early return must not skip it.
  check('a two-character Chinese name matches inside running text',
    checkCompanyMatch('我们是腾讯的招聘团队', '腾讯'), true);
  check('a two-character Japanese name matches after 株式会社',
    checkCompanyMatch('株式会社京東グループより', '京東'), true);
  check('the Chinese suffix normalisation still works',
    checkCompanyMatch('腾讯からのご連絡', '腾讯有限公司'), true);
  // Guard: a CJK name genuinely absent still fails, so the cases above cannot
  // be passing because CJK matches everything.
  check('an absent Chinese name still fails',
    checkCompanyMatch('我们是阿里巴巴的招聘团队', '腾讯'), false);
  // NO_WORD_SEPARATOR_RE lists four scripts, and 京東 above is Han despite its
  // Japanese surroundings — so Hiragana, Katakana and Hangul were listed but
  // never exercised, and dropping any of them would have failed no test
  // (CodeRabbit, #3001). One short name per remaining script.
  check('a short Hiragana name matches inside running text',
    checkCompanyMatch('あおの採用チームです', 'あお'), true);
  check('a short Katakana name matches inside running text',
    checkCompanyMatch('テクの採用チームです', 'テク'), true);
  // Korean is NOT on the substring path: 띄어쓰기 separates words, so the
  // boundary rule applies to it as it does to Latin — it matches as a word, and
  // is refused inside a longer one. Listing Hangul as separator-less would have
  // waived the guard for no gain.
  check('a Korean name matches when spaced as a word',
    checkCompanyMatch('네이버 채용팀입니다', '네이버'), true);
  check('...and is refused inside a longer Hangul word',
    checkCompanyMatch('앞네이버뒤 채용팀입니다', '네이버'), false);

  // ── 2c. Length is counted in CODE POINTS, not UTF-16 units ──
  // `String.length` counts units, so a three-character name built from
  // supplementary-plane characters reports 4 and slipped past SHORT_NAME_MAX
  // into the substring path — the same name would be boundary-checked in the
  // BMP (CodeRabbit, #3001).
  check('a 3-code-point astral name is treated as short, not substring-matched',
    checkCompanyMatch('prefix𐐀BCsuffix', '𐐀BC'), false);
  check('...and still matches when it stands as a word',
    checkCompanyMatch('bienvenue chez 𐐀BC', '𐐀BC'), true);

  // ── 3. End to end: the reply must not land on the placeholder row ──
  // Both applications exist; the mail belongs to neither. Before the fix it was
  // attributed to #1 with confidence `high` on the strength of a "?".
  const apps = [
    { num: 1, company: '?', role: 'Developpeur Fullstack' },
    { num: 2, company: 'Acme', role: 'Backend Engineer' },
  ];
  const candidates = [{
    message_id: 'm1',
    from: 'rh@societe-sans-rapport.com',
    subject: 'Suite a votre candidature',
    body_snippet: 'Seriez-vous disponible pour un interview la semaine prochaine ?',
  }];
  const matched = matchCandidates(candidates, apps, []);
  const onPlaceholder = matched.filter((m) => m.application_num === 1);
  if (onPlaceholder.length === 0) {
    pass('an unrelated reply no longer attaches to the "?" application');
  } else {
    fail(`still attached to the placeholder row: ${JSON.stringify(onPlaceholder)}`);
  }

  // Guard: a reply that genuinely names a tracked company still matches, so the
  // fix cannot be passing case 3 by matching nothing at all.
  const realMatch = matchCandidates([{
    message_id: 'm2',
    from: 'talent@acme.com',
    subject: 'Acme — Backend Engineer',
    body_snippet: 'Nous aimerions vous proposer un interview.',
  }], apps, []);
  const onAcme = realMatch.filter((m) => m.application_num === 2);
  if (onAcme.length === 1 && onAcme[0].confidence === 'high') {
    pass('a reply naming the company and role still matches it with high confidence');
  } else {
    fail(`real match regressed: ${JSON.stringify(realMatch)}`);
  }
} catch (error) {
  fail(`reply-matcher tests could not run: ${error.message}`);
}
