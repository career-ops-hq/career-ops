// tests/company-match-corporate-forms.test.mjs
//
// companyMatch('株式会社メルカリ', 'メルカリ') returned false even after #2445/#2569 taught the
// key builders to keep non-Latin text: the character before メルカリ in 株式会社メルカリ is 社,
// a letter, so no anchor rule can treat that position as a word boundary, and CJK/Korean do not
// delimit words with spaces the way the containment fallback (or LEGAL_SUFFIXES in
// invite-match.mjs) assumes. The fix strips one known corporate-form marker as an unspaced prefix
// or suffix before the equality and containment checks run — deliberately narrower than loosening
// the anchors, which would let アカネ match アカネスタジオ.
//
// This key has to SPLIT rather than merge, so the discrimination cases below are load-bearing:
// each strip creates a new chance to collapse two companies that are genuinely different.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ncompanyMatch — CJK/Korean corporate-form markers (#2570)');
try {
  const { companyMatch } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  // The exact regression pair confirmed on the issue.
  if (companyMatch('株式会社メルカリ', 'メルカリ') === true) {
    pass('companyMatch strips an unspaced 株式会社 prefix (#2570 repro)');
  } else {
    fail('companyMatch still misses 株式会社メルカリ vs メルカリ');
  }

  // Suffix form, also unspaced — LEGAL_SUFFIXES' \s-anchor could never reach
  // this either, so this is a distinct code path from the prefix case above.
  if (companyMatch('メルカリ株式会社', 'メルカリ') === true) {
    pass('companyMatch strips an unspaced 株式会社 suffix');
  } else {
    fail('companyMatch still misses メルカリ株式会社 vs メルカリ');
  }

  // Chinese and Korean forms, and the longer-form-first rule (股份有限公司
  // before 有限公司) so a strip doesn't leave a dangling 股份 behind.
  if (companyMatch('阿里巴巴集团股份有限公司', '阿里巴巴集团') === true
      && companyMatch('삼성전자주식회사', '삼성전자') === true) {
    pass('companyMatch strips Chinese and Korean corporate-form markers too');
  } else {
    fail('companyMatch missed a Chinese or Korean corporate-form strip');
  }

  // Unrelated companies must still stay unrelated even once a form is
  // stripped from each side — the strip must not turn discrimination into
  // false collapse.
  if (companyMatch('株式会社アカネ', '合同会社ゾロ') === false) {
    pass('companyMatch keeps two unrelated companies apart after stripping their forms');
  } else {
    fail('companyMatch collapsed two unrelated companies via corporate-form stripping');
  }

  // Same trade name, DIFFERENT legal form: a KK and a GK are two different
  // legal entities, so these must stay apart. This is the case the strip can
  // get wrong — stripping each side independently collapses them — and it is
  // the discrimination case with teeth, because it varies ONLY the form. The
  // case below it (different name AND different form) passes with or without
  // the strip, so it cannot catch this on its own.
  if (companyMatch('株式会社アカネ', '合同会社アカネ') === false
      && companyMatch('阿里有限公司', '阿里株式会社') === false
      && companyMatch('小米股份有限公司', '小米有限公司') === false) {
    pass('companyMatch keeps same-name/different-form entities apart (no false merge)');
  } else {
    fail('companyMatch merged two entities that differ only by corporate form');
  }

  // A name that IS only the marker must fall back to the unstripped key
  // rather than handing the equality check an empty "no signal" string,
  // the same discipline #2445 established for the base normalizeTextKey.
  // Both directions: two different bare markers must not collapse, and one
  // bare marker must still equal itself. The second assertion is the only
  // witness the fallback has — without it the first passes either way.
  if (companyMatch('株式会社', '合同会社') === false
      && companyMatch('株式会社', '株式会社') === true) {
    pass('companyMatch falls back to the unstripped key for bare corporate-form-only names');
  } else {
    fail('companyMatch mishandled a bare corporate-form-only name');
  }

  // A marker-only key carries no trade name, so it must not match one that
  // does, nor another marker-only key that differs from it. 株式会社 vs
  // 株式会社株式会社 matched before this change; it is now held by the
  // different-form check. The punctuated pair is the bare check's own witness:
  // the no-space key sees 株式会社 bare vs 株式会社アカネ, while the spaced key
  // sees no form at all, so without the check containment matches 株式 会社
  // inside 株式 会社 アカネ. The last pair, two marker-only names, matched
  // before this change: the single strip took 株式会社 off each (suffix on one,
  // prefix on the other), leaving an equal 合同会社.
  if (companyMatch('株式会社', '株式会社株式会社') === false
      && companyMatch('株式・会社', '株式・会社 アカネ') === false
      && companyMatch('合同会社 株式会社', '株式会社 合同会社') === false) {
    pass('companyMatch keeps a bare corporate-form name apart from a repeated marker');
  } else {
    fail('companyMatch merged a bare corporate-form name with a repeated marker');
  }

  // Different forms must be a verdict, not just a declined strip. Declining
  // left the raw keys to the containment fallback, where 株式会社アカネ is a
  // bounded substring of 合同会社 株式会社アカネ — whose leading form is 合同会社.
  // Both edges count: a name carrying a form at each end must not be compared
  // on whichever single form list order happens to find first, or the mirrored
  // pairs (株式会社 shared, 合同会社 ignored) still merge. The unspaced pair
  // was already false before; it guards the no-space key. The last pair has
  // the same two forms swapped between the edges, and stays apart.
  if (companyMatch('株式会社アカネ', '合同会社 株式会社アカネ') === false
      && companyMatch('株式会社アカネ', '合同会社株式会社アカネ') === false
      && companyMatch('アカネ株式会社', '合同会社 アカネ株式会社') === false
      && companyMatch('株式会社アカネ', '株式会社アカネ 合同会社') === false
      && companyMatch('株式会社アカネ有限会社', '有限会社アカネ株式会社') === false) {
    pass('companyMatch keeps different-form names apart in the containment fallback too');
  } else {
    fail('companyMatch let containment merge two names carrying different corporate forms');
  }

  // Forms added after #3957. 有限责任公司 / 有限責任公司 do not end in 有限公司
  // (责任 sits between), so the existing entry could never reach them.
  const moreForms = [
    ['阿里巴巴有限责任公司', '阿里巴巴'],
    ['阿里巴巴有限責任公司', '阿里巴巴'],
    ['合名会社アカネ', 'アカネ'],
    ['合資会社アカネ', 'アカネ'],
    ['一般社団法人アカネ', 'アカネ'],
    ['유한회사카카오', '카카오'],
  ];
  const missed = moreForms.filter(([a, b]) => companyMatch(a, b) !== true);
  if (missed.length === 0) {
    pass('companyMatch strips 有限责任公司/有限責任公司, 合名会社, 合資会社, 一般社団法人 and 유한회사');
  } else {
    fail(`companyMatch missed corporate-form strips: ${missed.map(([a]) => a).join(', ')}`);
  }

  // The new forms obey the same different-form rule as the original ones.
  if (companyMatch('合名会社アカネ', '合資会社アカネ') === false
      && companyMatch('小米有限责任公司', '小米有限公司') === false) {
    pass('companyMatch keeps same-name/different-form apart for the added forms');
  } else {
    fail('companyMatch merged two entities differing only by an added corporate form');
  }

  // A form embedded mid-name (neither a prefix nor a suffix) must not be
  // stripped — this is deliberately narrower than substring removal.
  if (companyMatch('メルカリ株式会社ジャパン', 'メルカリ') === false) {
    pass('companyMatch does not strip a corporate-form marker that is not at an edge');
  } else {
    fail('companyMatch over-stripped a mid-name corporate-form marker');
  }

  // Regression: Latin behavior must be untouched by a CJK-only list.
  if (companyMatch('Acme Inc.', 'acme inc') === true && companyMatch('Acme', 'Zoro Inc') === false) {
    pass('regression: Latin companyMatch unaffected by corporate-form stripping');
  } else {
    fail('Latin companyMatch behavior changed after adding corporate-form stripping');
  }
} catch (e) {
  fail(`companyMatch corporate-form tests crashed: ${e.message}`);
}
