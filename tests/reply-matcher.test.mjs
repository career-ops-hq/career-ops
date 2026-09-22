import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDomain,
  checkCompanyMatch,
  checkRoleMatch,
  checkRoleMatchExact,
  getAppDomains,
  matchCandidates,
  classifyReply
} from '../reply-matcher.mjs';

// getAppDomains returns an array of bare hostnames, so membership is already an
// exact whole-string comparison. Assert it through `===` rather than
// Array.prototype.includes: CodeQL's js/incomplete-url-substring-sanitization
// reads any `.includes('<host>.<tld>')` as a substring test against a URL and
// cannot see that the receiver is an array. The literal alone trips it — the
// rule fired on the four `.com` fixtures below and ignored the structurally
// identical `.example` ones on adjacent lines.
const hasDomain = (domains, domain) => domains.some(d => d === domain);

test('extractDomain', () => {
  assert.equal(extractDomain('notice@fundeliver.com'), 'fundeliver.com');
  assert.equal(extractDomain('Jane Doe <jane.doe@lever.co>'), 'lever.co');
  assert.equal(extractDomain('invalid-email'), null);
});

test('checkCompanyMatch', () => {
  // English matches
  assert.ok(checkCompanyMatch('Interview with Acme Corp', 'Acme Corp'));
  assert.ok(checkCompanyMatch('Interview with acme corp', 'Acme Corp'));
  assert.ok(checkCompanyMatch('Interview with AcmeCorp', 'Acme Corp'));
  
  // Chinese matches
  assert.ok(checkCompanyMatch('恭喜简历通过，杭州赢云贸易有限公司邀您面试', '杭州赢云贸易有限公司'));
  // Partial Chinese (omitting '有限公司')
  assert.ok(checkCompanyMatch('恭喜简历通过，杭州赢云贸易邀您面试', '杭州赢云贸易有限公司'));
  // Fails
  assert.equal(checkCompanyMatch('Interview with Random', 'Acme Corp'), false);
});

test('checkRoleMatch', () => {
  assert.ok(checkRoleMatch('Update for Software Engineer role', 'Software Engineer'));
  // Chinese role matches
  assert.ok(checkRoleMatch('邀请您参加PY01_python开发工程师的面试', 'python开发工程师'));
  assert.ok(checkRoleMatch('邀请您参加python开发工程师的面试', 'PY01_python开发工程师'));
});

test('checkRoleMatch - a role word inside a longer word is not a match (#3455)', () => {
  // Rejection boilerplate that names neither role. "Analytic" appears only as a
  // prefix of "Analytics", which is not a mention of the role and must not
  // corroborate one. Before this fix `tNorm.includes()` matched it, and because
  // matchCandidates() only counts a partial match on a row already carrying a
  // company or domain signal, the effect was to inflate whichever row was
  // already ahead — see #3455.
  const boilerplate = 'Unfortunately we will not be moving forward. We will retain your '
    + 'data on file. Please watch our Analytics openings for future roles.';
  assert.equal(checkRoleMatch(boilerplate, 'Managing VP, Analytic & AI Product'), false);

  // The same shape, isolated: a role word must not match as a substring of a
  // longer word, in either direction.
  assert.equal(checkRoleMatch('We have moved to a new database vendor.', 'Data Engineer'), false);
  assert.equal(checkRoleMatch('Our platforms team will follow up.', 'Platform Lead'), false);
  assert.equal(checkRoleMatch('Please see the attached engineering brief.', 'Engineer'), false);

  // ...but a genuine whole-word occurrence still matches. This is deliberate:
  // it is what keeps the partial-match path useful for a real mention.
  assert.ok(checkRoleMatch('An update on the Analytic role you applied for.', 'Managing VP, Analytic & AI Product'));
});

test('checkRoleMatch - a common noun in a role title still matches as a whole word (#3455 limit)', () => {
  // Documents the boundary of the #3455 fix rather than asserting desired
  // behaviour. "data" occurs as a real word in ordinary rejection prose, so a
  // word-boundary rule cannot exclude it — only the GENERIC_ROLE_WORDS
  // enumeration could, and enumerating every domain noun does not scale.
  // Half of darkpandawarrior's two-row example is therefore still reachable;
  // the ownership rule in #3455, not this fix, is what closes that.
  const boilerplate = 'Unfortunately we will not be moving forward. We will retain your '
    + 'data on file. Please watch our Analytics openings for future roles.';
  assert.ok(checkRoleMatch(boilerplate, 'Senior Director, AI Data'));
});

test('checkRoleMatch - stripping punctuation must not push a non-Latin part under the length gate', () => {
  // "工程师。" is four characters, three once the ideographic period is stripped.
  // The stripped form belongs to the Latin branch only; gating every script on
  // it silently dropped three-character Chinese titles — 工程师 (engineer),
  // 设计师 (designer) — that the substring path had always matched. This is why
  // the script routing runs before the length and generic-word gates rather
  // than after them.
  assert.ok(checkRoleMatch('我们招聘工程师。欢迎申请。', 'PY_工程师。'));
  assert.ok(checkRoleMatch('我们招聘工程师，欢迎申请。', 'PY_工程师，'));
  assert.ok(checkRoleMatch('私たちはエンジ。を募集。', 'JP_エンジ。'));
});

test('checkRoleMatch - a mixed Latin+Han part is not Latin, so it keeps substring matching', () => {
  // "python开发工程师" is one semantic phrase, not a Latin word followed by a
  // Chinese one, so the Latin-only gate correctly declines to apply a boundary
  // rule to it. These two are the pre-existing cases from the suite above,
  // repeated here as the regression guard for the mixed-script path.
  assert.ok(checkRoleMatch('邀请您参加PY01_python开发工程师的面试', 'python开发工程师'));
  assert.ok(checkRoleMatch('邀请您参加python开发工程师的面试', 'PY01_python开发工程师'));
});

test('checkRoleMatch - non-Latin role words keep the substring test unchanged', () => {
  // The whole-word rule is deliberately Latin-only. "Which scripts have word
  // boundaries" has no clean answer, and two earlier drafts of this fix each
  // broke a different language by trying to answer it:
  //
  //   Japanese  runs without separators in ALL THREE of its scripts, so routing
  //             on Han ideographs alone sent a pure-Katakana title down the
  //             boundary path, where the surrounding Hiragana is \p{L}.
  //   Korean    DOES separate words with spaces, but glues grammatical
  //             particles straight onto the noun — 개발자 + 를 -> 개발자를 — so
  //             the boundary never holds even though the title is right there.
  //
  // Every case below is a role genuinely mentioned in the text, and every one
  // must behave exactly as it did before this change.
  assert.ok(checkRoleMatch('私たちはエンジニアを募集しています。', 'PY02_エンジニア'));
  assert.ok(checkRoleMatch('私たちは上級エンジニアを募集しています。', '上級エンジニア'));
  assert.ok(checkRoleMatch('우리는 소프트웨어개발자를 찾고 있습니다.', 'KR_소프트웨어개발자'));
  assert.ok(checkRoleMatch('프로젝트매니저의 면접 일정을 안내드립니다.', 'KR_프로젝트매니저'));
  assert.ok(checkRoleMatch('Мы ищем Разработчика в команду.', 'RU_Разработчик'));
  assert.ok(checkRoleMatch('نبحث عن مهندس برمجيات للانضمام.', 'AR_مهندس_برمجيات'));
});

test('checkRoleMatch - a pathologically long role part does not crash the matcher', () => {
  // matchesOnWordBoundary builds new RegExp(..., 'iu'), and V8 stack-overflows
  // constructing a case-insensitive Unicode pattern around a long enough
  // literal — it THROWS at construction. checkCompanyMatch, the helper's only
  // other caller, is gated by isShortName and can never reach that; a role part
  // has no such ceiling, so without MAX_BOUNDARY_NEEDLE this throw escapes
  // matchCandidates() uncaught and takes reply-watch down for every candidate
  // in the run — not a graceful non-match on one row.
  //
  // Reachable from a single malformed tracker row: a JD pasted into the role
  // field, or a merged CSV column.
  const huge = 'Word'.repeat(2500);
  assert.doesNotThrow(() => checkRoleMatch('unrelated rejection text', huge));
  assert.doesNotThrow(() => matchCandidates(
    [{ message_id: 'm', from: 'a@b.example', subject: 's', body_snippet: 'unrelated', signal: 'rejection' }],
    [{ num: 1, company: 'Acme', role: huge, status: 'Applied', notes: '' }],
    []
  ));
  // Over the ceiling it takes the substring path, which is what main did.
  assert.ok(checkRoleMatch(`we mentioned ${huge} once`, huge));

  // Pin the threshold itself, not just "well past it". A part of exactly
  // MAX_BOUNDARY_NEEDLE characters is still ON the whole-word path, so it must
  // refuse a substring-inside-a-longer-word; flipping the comparison to >=
  // would push it to the substring fallback and match. Inert in practice — 128
  // has enormous headroom over any real role word — but the boundary of a
  // guard is the part worth pinning.
  const atCeiling = 'a'.repeat(128);
  assert.equal(checkRoleMatch(`about the ${atCeiling}x team`, atCeiling), false);
  assert.ok(checkRoleMatch(`about the ${atCeiling} team`, atCeiling));
});

test('checkRoleMatch - the generic-word gate runs on the stripped form, not the raw part', () => {
  // "Recruiter," is not in GENERIC_ROLE_WORDS; "recruiter" is. Checking the raw
  // part lets any attached punctuation walk a generic word straight past the
  // #2671 protection, which is the bug that rule exists to stop.
  assert.equal(checkRoleMatch('Please contact our Recruiter, team lead, for more info.', 'Recruiter,'), false);
  // Text carries only the punctuated generic word, never the whole role — so
  // this exercises the partial path rather than checkRoleMatchExact.
  assert.equal(checkRoleMatch('Our Operations. team will be in touch.', 'People Operations.'), false);
});

test('checkRoleMatch - a combining mark keeps a Latin word on the whole-word path (#3535)', () => {
  // toLowerCase() can INTRODUCE a character that is not Script=Latin: "İ"
  // (U+0130) becomes "i" + U+0307, and U+0307 is \p{M}/Script=Inherited. A Latin
  // gate without \p{M} therefore drops these words to the substring path and the
  // bug survives for them.
  //
  // Turkish dotted-I, the case that exposed it:
  assert.equal(checkRoleMatch('Bizim İstatistikler ekibi yanıt verecek.', 'İstatistik Uzmanı'), false);
  assert.ok(checkRoleMatch('Bizim İstatistik ekibi yanıt verecek.', 'İstatistik Uzmanı'));

  // ...and NFD-decomposed accented text, which is the broader half — it needs no
  // Turkish at all and reaches French, Spanish, Portuguese and Vietnamese.
  const nfd = 'Ingénieur';           // e + combining acute, not U+00E9
  assert.equal(checkRoleMatch(`Notre équipe ${nfd}ie recrute.`, `${nfd} Logiciel`), false);
  assert.ok(checkRoleMatch(`Notre équipe ${nfd} recrute.`, `${nfd} Logiciel`));

  // A mark belongs to the base letter before it, so a needle sitting next to one
  // is mid-word, not at a boundary. Both lookarounds need \p{M}, and they fail
  // independently — hence a case on each side.
  //
  // mark AFTER the needle:
  assert.equal(checkRoleMatch('Our datá pipeline is unrelated.', 'Data Engineer'), false);
  // mark BEFORE the needle — a decomposed accented word running straight into
  // it, as happens in slugs, filenames and run-together compounds:
  assert.equal(checkRoleMatch('Attached: re\u0301sume\u0301data.pdf for review.', 'Data Engineer'), false);
});

test('checkRoleMatch - an NFD word ending in a combining mark keeps it (#3535)', () => {
  // Escapes, not literals: a source-file "\u00e9" is PRECOMPOSED and does not
  // exercise this path at all. The bug needs a word whose LAST character is a
  // combining mark.
  //
  // \\p{M} has to be in the stripping class as well as in LATIN_WORD_RE and the
  // lookarounds. Without it the terminal mark is peeled off as though it were
  // punctuation — "Charge\u0301" strips to "Charge" — and the boundary test then
  // correctly refuses that, because the mark still present in the text makes
  // the position mid-grapheme. The word stops matching itself.
  const charge = 'Charge\u0301';   // Chargé, mark terminal
  const cafe   = 'Cafe\u0301';     // Café, mark terminal
  const disena = 'Disen\u0303ador'; // Diseñador, mark interior

  // Text carries the PART but not the whole role, so checkRoleMatchExact cannot
  // short-circuit and mask the partial path — which is what hid this at first.
  assert.ok(checkRoleMatch(`Le poste de ${charge} est ouvert.`, `${charge} de Mission`));
  assert.ok(checkRoleMatch(`Notre ${cafe} recrute.`, `${cafe} Manager`));
  assert.ok(checkRoleMatch(`Buscamos un ${disena} para el equipo.`, `${disena} Senior`));

  // ...and the whole-word rule still applies to them.
  assert.equal(checkRoleMatch(`Le poste de ${charge}s est ouvert.`, `${charge} de Mission`), false);
});
test('checkRoleMatch - a Latin role word containing digits still gets the whole-word rule', () => {
  // The \p{N} in LATIN_WORD_RE is load-bearing. Without it a part carrying a
  // digit — "Web3", "K8s", "Tier2" are all ordinary in job titles — fails the
  // Latin allowlist, falls through to the substring path, and the #3455 bug is
  // back for exactly those titles.
  assert.equal(checkRoleMatch('Our Web3D research group published a paper.', 'Web3 Platform Lead'), false);
  // ...and the genuine whole-word mention still matches.
  assert.ok(checkRoleMatch('An update on the Web3 role you applied for.', 'Web3 Platform Lead'));
});

test('checkRoleMatch - a role word is not matched at a letter-adjacent prefix either', () => {
  // The left lookbehind carries its own weight: without it, a role word glued to
  // the END of a longer word still matches. The CJK case above cannot catch this
  // because "data" there is letter-bounded on BOTH sides, so the right-hand
  // lookahead alone already rejects it.
  assert.equal(checkRoleMatch('The XAnalytic system flagged this for review.', 'Managing VP, Analytic & AI Product'), false);
  assert.equal(checkRoleMatch('Our metadata pipeline is unrelated.', 'Data Engineer'), false);
});

test('checkRoleMatch - a short root word is not made significant by attached punctuation', () => {
  // The length gate runs again after stripping. Without the second check, "AI!!"
  // (4 raw chars, 2 real ones) would clear a gate meant to admit only words with
  // more than three significant characters.
  assert.equal(checkRoleMatch('Our team uses ai to triage applications.', 'AI!! Specialist'), false);
  assert.equal(checkRoleMatch('The ops team will follow up.', 'Ops. Lead'), false);
});

test('checkRoleMatch - the word boundary is defined on letters in any script, not \\w', () => {
  // These two cases are the whole reason the rule uses \p{L}/\p{N} lookarounds
  // rather than \b. \b is defined on [A-Za-z0-9_], which is wrong twice over:
  //
  //   "data工程师"     a CJK ideograph is not \w, so \b sees a boundary and
  //                    matches "data" INSIDE a single Chinese compound word —
  //                    exactly the substring-inside-a-word bug this fix exists
  //                    to remove, reintroduced for every non-Latin script.
  assert.equal(checkRoleMatch('我们正在招聘data工程师。', 'Data Analyst'), false);

  //   "data_engineer"  "_" IS \w, so \b sees NO boundary and misses a genuine
  //                    mention. "_" is one of the separators role titles are
  //                    split on, so treating it as a boundary is the consistent
  //                    reading.
  assert.ok(checkRoleMatch('Subject: data_engineer role update', 'Data Engineer'));
});

test('checkRoleMatch - punctuation attached to a role word does not defeat the match', () => {
  // Parts are split on [\s_\\/()-]+, which leaves a trailing comma on "Director,".
  // A naive `\b${part}\b` fails here: the \b after "," needs a word character
  // next, and a space follows.
  assert.ok(checkRoleMatch('Congratulations on the Director offer.', 'Senior Director, AI Data'));
});

test('checkRoleMatch - generic recruiting words never match alone (#2671)', () => {
  // A signature line from an unrelated recruiter ("Talent Acquisition & Diversity")
  // must not satisfy a role match against a "Talent Acquisition Specialist"
  // tracker row just because "Talent" and "Acquisition" both appear >3 chars long.
  assert.equal(
    checkRoleMatch('Jane Doe, Talent Acquisition & Diversity, Contoso Inc.', 'Talent Acquisition Specialist'),
    false
  );
  assert.equal(checkRoleMatch('Our People Operations team will be in touch.', 'People Operations Coordinator'), false);
  assert.equal(checkRoleMatch('Please reach out to our recruiter for next steps.', 'Recruiter'), false);
});

test('checkRoleMatchExact - only a full contiguous role-title match counts', () => {
  assert.ok(checkRoleMatchExact('Update for Software Engineer role', 'Software Engineer'));
  assert.equal(
    checkRoleMatchExact('Jane Doe, Talent Acquisition & Diversity, Contoso Inc.', 'Talent Acquisition Specialist'),
    false
  );
  // A genuinely specific, non-generic partial word is not "exact" either —
  // checkRoleMatchExact only credits the whole role string.
  assert.equal(checkRoleMatchExact('邀请您参加python开发工程师的面试', 'PY01_python开发工程师'), false);
  // Chinese compound titles have no separators to split on, so a "single part"
  // Chinese role is still a whole-role match, not a bare single word.
  assert.ok(checkRoleMatchExact('邀请您参加python开发工程师的面试', 'python开发工程师'));
});

test('checkRoleMatchExact - a single-word role, even a specific one, never counts standalone (CodeRabbit #2672)', () => {
  // "Engineer" is not generic-recruiting vocabulary, but a single word gives a
  // "whole role" check no more specificity than a bare-word check — it must
  // fall through to the partial-match path and require corroboration, same as
  // any other single significant word.
  assert.equal(checkRoleMatchExact('We are excited to have you interview as an Engineer.', 'Engineer'), false);
  // checkRoleMatch (the boolean convenience wrapper) still reports a match via
  // the partial-word path; matchCandidates is what enforces corroboration.
  assert.ok(checkRoleMatch('We are excited to have you interview as an Engineer.', 'Engineer'));
});

test('checkRoleMatchExact - a whitespace-only role never matches (CodeRabbit #2672)', () => {
  // normalizeStr(' ') === '', and ''.includes('') === true for any text, so a
  // blank role must be explicitly rejected — otherwise it would "exactly"
  // match arbitrary text and bypass corroboration entirely. isSingleWordRole
  // doesn't catch this: splitting a whitespace-only string on separators
  // yields zero parts, not one.
  assert.equal(checkRoleMatchExact('Completely unrelated message about anything at all.', '   '), false);
  assert.equal(checkRoleMatchExact('Completely unrelated message about anything at all.', ' '), false);
});

test('getAppDomains - drops prose tokens and filenames, keeps real hostnames', () => {
  const app = {
    num: 68,
    company: 'Northwind',
    role: 'VP, Demand Generation',
    notes: 'Near-bullseye remote VP-DG at enterprise SaaS; no hard blockers (MBA/vertical-pod soft gaps).; Applied via careers.northwind.com, Remote-US. Comp expectation submitted before the screen. CV: output/cv-vp-demand-generation-2026-06-23.pdf'
  };

  const domains = getAppDomains(app, []);

  assert.ok(hasDomain(domains, 'northwind.com'), 'company-domain guess must survive');
  assert.ok(hasDomain(domains, 'careers.northwind.com'), 'employer subdomain in notes must survive');
  for (const junk of ['gaps.', 'remote-us.', 'screen.', 'outputcv-vp-demand-generation-2026-06-23.pdf']) {
    assert.ok(!hasDomain(domains, junk), `expected junk token "${junk}" to be dropped`);
  }
});

test('getAppDomains - keeps an employer contact domain but skips the confidential-marker guess', () => {
  const app = {
    num: 270,
    company: '?',
    role: 'Vice President of Marketing - Franchisor',
    notes: 'Recruiter search on behalf of an undisclosed franchisor client. Emailed resume to founder@franchise-search.example and asked whether the search is remote or location-tied. Their other posting (clientco.applytojob.com/apply/F2cqqwBuit) reads like a different client, so not applied to directly.'
  };

  const domains = getAppDomains(app, []);

  assert.ok(hasDomain(domains, 'franchise-search.example'), 'employer contact domain must survive');
  for (const junk of ['client.', 'location-tied.', 'directly.', '?.com', '?.co', '?.io']) {
    assert.ok(!hasDomain(domains, junk), `expected junk token "${junk}" to be dropped`);
  }
  assert.ok(
    !domains.some(d => d.includes('applytojob')),
    'a shared ATS host mentioned in notes must not become a candidate domain'
  );
});

test('getAppDomains - drops a score delta and keeps the recruiter domain', () => {
  const app = {
    num: 234,
    company: '?',
    role: 'Vice President Marketing',
    notes: 'Re-eval 2026-07-12, score 3.3/4.5. Build-from-scratch VP Mktg sourced via TalentPartners. Emailed resume to recruiter@talent-partners.example and asked about similar searches.'
  };

  const domains = getAppDomains(app, []);

  assert.ok(hasDomain(domains, 'talent-partners.example'), 'recruiter contact domain must survive');
  for (const junk of ['3.34.5.', 'talentpartners.', 'searches.', '?.com', '?.co', '?.io']) {
    assert.ok(!hasDomain(domains, junk), `expected junk token "${junk}" to be dropped`);
  }
});

test('getAppDomains - rejects bare filenames whose extension parses as a TLD', () => {
  const app = {
    num: 30,
    company: 'Initech',
    role: 'Head of Growth',
    notes: 'Tailored from cv.md. Proof points pulled from article-digest.md, cover draft saved as cover-letter.pdf. Recruiter is talent@initech-group.example.'
  };

  const domains = getAppDomains(app, []);

  assert.ok(hasDomain(domains, 'initech.com'), 'company-domain guess must survive');
  assert.ok(hasDomain(domains, 'initech-group.example'), 'employer contact domain must survive');
  for (const filename of ['cv.md', 'article-digest.md', 'cover-letter.pdf']) {
    assert.ok(!hasDomain(domains, filename), `expected filename "${filename}" to be dropped`);
  }
});

test('getAppDomains - drops shared ATS, job-board and webmail domains', () => {
  const app = {
    num: 12,
    company: 'Globex',
    role: 'Director of Marketing',
    notes: 'Applied via LinkedIn.com; req tracked at greenhouse.io for this team. Screener wrote from screening@gmail.com, hiring manager is manager@globex-hq.example.'
  };
  const followups = [
    {
      appNum: 12,
      contact: 'recruiter@outlook.com',
      notes: 'Left a voicemail and also emailed talent@myworkday.com about scheduling.'
    }
  ];

  const domains = getAppDomains(app, followups);

  assert.ok(hasDomain(domains, 'globex.com'), 'company-domain guess must survive');
  assert.ok(hasDomain(domains, 'globex-hq.example'), 'employer contact domain in notes must survive');
  for (const shared of ['linkedin.com', 'greenhouse.io', 'gmail.com', 'outlook.com', 'myworkday.com']) {
    assert.ok(!hasDomain(domains, shared), `expected shared domain "${shared}" to be dropped`);
  }
});

test('matchCandidates - high confidence with company + role', () => {
  const apps = [
    { num: 1, company: 'Acme Corp', role: 'Software Engineer', notes: '' },
    { num: 2, company: '杭州赢云贸易有限公司', role: 'PY01_python开发工程师', notes: '' }
  ];
  
  const candidates = [
    {
      message_id: 'msg1',
      from: 'notice@acmecorp.com',
      subject: 'Interview for Software Engineer at Acme Corp',
      body_snippet: 'We would like to invite you...',
      signal: 'interview_invite'
    },
    {
      message_id: 'msg2',
      from: 'Notice@fundeliver.com',
      subject: '恭喜简历通过，杭州赢云贸易有限公司邀您面试',
      body_snippet: '邀请您参加PY01_python开发工程师的面试... AI微信小程序面试',
      signal: 'interview_invite'
    }
  ];
  
  const results = matchCandidates(candidates, apps, []);
  
  assert.equal(results.length, 2);
  
  assert.equal(results[0].application_num, 1);
  assert.equal(results[0].confidence, 'high');
  assert.ok(results[0].signals.includes('company-name'));
  assert.ok(results[0].signals.includes('role-title'));
  
  assert.equal(results[1].application_num, 2);
  assert.equal(results[1].confidence, 'high');
  assert.equal(results[1].company_hint, '杭州赢云贸易有限公司');
});

test('matchCandidates - medium confidence domain match', () => {
  const apps = [
    { num: 3, company: 'Tech Startup', role: 'Data Scientist', notes: 'recruiter@techstartup.io' }
  ];
  
  const candidates = [
    {
      message_id: 'msg3',
      from: 'jane@techstartup.io',
      subject: 'Application Update',
      body_snippet: 'Thank you for applying to our open position.',
      signal: 'update'
    }
  ];
  
  const results = matchCandidates(candidates, apps, []);
  assert.equal(results[0].application_num, 3);
  assert.equal(results[0].confidence, 'medium');
  assert.ok(results[0].signals.includes('sender-domain'));
});

test('matchCandidates - ambiguous matches', () => {
  const apps = [
    { num: 4, company: 'BigBank', role: 'Backend Dev', notes: '' },
    { num: 5, company: 'BigBank', role: 'Frontend Dev', notes: '' }
  ];
  
  const candidates = [
    {
      message_id: 'msg4',
      from: 'recruiting@bigbank.com',
      subject: 'Interview with BigBank',
      body_snippet: 'We want to proceed with your application.',
      signal: 'interview_invite'
    }
  ];
  
  const results = matchCandidates(candidates, apps, []);
  assert.equal(results[0].application_num, null);
  assert.equal(results[0].confidence, 'low');
  assert.ok(results[0].signals.includes('ambiguous-match'));
});

test('matchCandidates - no match', () => {
  const apps = [
    { num: 6, company: 'SmallCo', role: 'Dev', notes: '' }
  ];
  
  const candidates = [
    {
      message_id: 'msg5',
      from: 'spam@spam.com',
      subject: 'Buy our product',
      body_snippet: '...',
      signal: null
    }
  ];
  
  const results = matchCandidates(candidates, apps, []);
  assert.equal(results[0].application_num, null);
  assert.equal(results[0].confidence, 'low');
  assert.ok(results[0].signals.includes('no-match'));
});

test('matchCandidates - a shared ATS domain in one application does not capture unrelated mail', () => {
  const apps = [
    { num: 20, company: 'Initech', role: 'Head of Growth', notes: 'Applied through greenhouse.io for this req' },
    { num: 21, company: 'Umbrella', role: 'Marketing Director', notes: '' }
  ];

  const candidates = [
    {
      message_id: 'msg6',
      from: 'no-reply@greenhouse.io',
      subject: 'Your application to Umbrella',
      body_snippet: 'Thanks for your interest.',
      signal: null
    }
  ];

  const results = matchCandidates(candidates, apps, []);

  assert.equal(results.length, 1);
  assert.equal(results[0].application_num, 21);
  assert.ok(
    !results[0].signals.includes('sender-domain'),
    'a shared ATS sender must not score a domain match against an unrelated application'
  );
});

test('matchCandidates - a generic role-title word from an unrelated sender does not match (#2671)', () => {
  const apps = [
    { num: 30, company: 'Contoso', role: 'Talent Acquisition Specialist', notes: '' }
  ];

  const candidates = [
    {
      message_id: 'msg7',
      // Different company, different domain, no company-name mention. The only
      // overlap with the tracker row is the generic "Talent Acquisition" phrase
      // inside an unrelated recruiter's signature line, from a different thread
      // about a different role entirely.
      from: 'jane.doe@fabrikam.example',
      subject: 'Following up on your application to Fabrikam',
      body_snippet: 'Best,\nJane Doe\nTalent Acquisition & Diversity, Fabrikam',
      signal: null
    }
  ];

  const results = matchCandidates(candidates, apps, []);

  assert.equal(results.length, 1);
  assert.equal(results[0].application_num, null, 'a bare generic-word overlap must not be attributed to the tracker row');
  assert.ok(!results[0].signals.includes('role-title'));
});

test('matchCandidates - a partial role-word match corroborated by company name still matches', () => {
  const apps = [
    { num: 31, company: 'Northwind Traders', role: 'PY01_Senior Backend Engineer', notes: '' }
  ];

  const candidates = [
    {
      message_id: 'msg8',
      from: 'careers@northwindtraders.example',
      subject: 'Interview with Northwind Traders — Backend Engineer role',
      body_snippet: 'We would like to invite you to interview.',
      signal: 'interview_invite'
    }
  ];

  const results = matchCandidates(candidates, apps, []);

  assert.equal(results[0].application_num, 31);
  assert.ok(results[0].signals.includes('company-name'));
  assert.ok(results[0].signals.includes('role-title'));
  assert.equal(results[0].confidence, 'high');
});

test('matchCandidates - a partial role-word match corroborated by sender domain alone still matches (CodeRabbit #2672)', () => {
  const apps = [
    {
      num: 32,
      company: 'Fabrikam Systems',
      role: 'PY01_Senior Backend Engineer',
      notes: 'Recruiter contact: talent@fabrikam-careers.example'
    }
  ];

  const candidates = [
    {
      message_id: 'msg10',
      // Sender domain matches the recruiter contact domain in notes via
      // getAppDomains. Neither "Fabrikam" nor "Fabrikam Systems" appears
      // anywhere in the message text, so company-name matching cannot fire —
      // the only corroboration available is the sender domain.
      from: 'jane@fabrikam-careers.example',
      subject: 'Backend Engineer — next steps',
      body_snippet: 'We would like to invite you to interview.',
      signal: 'interview_invite'
    }
  ];

  const results = matchCandidates(candidates, apps, []);

  assert.equal(results[0].application_num, 32);
  assert.ok(results[0].signals.includes('sender-domain'));
  assert.ok(results[0].signals.includes('role-title'));
  assert.ok(!results[0].signals.includes('company-name'));
  assert.equal(results[0].confidence, 'high');
});

test('matchCandidates - a genuinely specific role match still works standalone', () => {
  // Regression guard: exact/near-exact and non-generic role matches must keep
  // working without corroboration, per the existing "high confidence" fixture.
  const apps = [
    { num: 1, company: 'Acme Corp', role: 'Software Engineer', notes: '' }
  ];

  const candidates = [
    {
      message_id: 'msg9',
      from: 'no-reply@unrelated.example',
      subject: 'Update for Software Engineer role',
      body_snippet: '',
      signal: null
    }
  ];

  const results = matchCandidates(candidates, apps, []);
  assert.equal(results[0].application_num, 1);
  assert.ok(results[0].signals.includes('role-title'));
});

test('classifyReply - high confidence interview fixtures', () => {
  const fixtures = [
    '恭喜简历通过，杭州赢云贸易有限公司邀您面试',
    '我司首轮面试是AI微信小程序面试',
    '面试形式：AI微信小程序面试',
    '面试时长：约15~30分钟',
    'Interview invitation: Senior Frontend Developer'
  ];
  for (const text of fixtures) {
    const res = classifyReply({ subject: text, body_snippet: '' });
    assert.equal(res.type, 'Interview');
    assert.equal(res.suggestedTrackerUpdate, 'Interview');
    assert.ok(res.evidence.length > 0);
  }
});

test('classifyReply - noise / job lead fixtures', () => {
  const fixtures = [
    '邀请投递测试工程师岗位',
    '现在沟通，抢面试先机',
    '近期热招职位',
    '立即投递',
    'Zhaopin job alert'
  ];
  for (const text of fixtures) {
    const res = classifyReply({ subject: text, body_snippet: '' });
    assert.equal(res.type, 'Noise');
    assert.equal(res.suggestedTrackerUpdate, 'none');
    assert.ok(res.evidence.length > 0);
  }
});

test('classifyReply - needs review / process activity', () => {
  const fixtures = [
    '邀请您在面试/入职之前更新或补充最新的应聘信息'
  ];
  for (const text of fixtures) {
    const res = classifyReply({ subject: text, body_snippet: '' });
    // This is classified as Unknown (needs review / process activity)
    assert.equal(res.type, 'Unknown');
    assert.equal(res.suggestedTrackerUpdate, 'Needs Review');
  }
});

test('classifyReply - rejection fixtures', () => {
  const fixtures = [
    '很遗憾',
    '暂不匹配',
    '不合适',
    '未能进入下一轮',
    'Unfortunately we decided not to proceed'
  ];
  for (const text of fixtures) {
    const res = classifyReply({ subject: text, body_snippet: '' });
    assert.equal(res.type, 'Rejected');
    assert.equal(res.suggestedTrackerUpdate, 'Rejected');
    assert.ok(res.evidence.length > 0);
  }
});

test('classifyReply - offer fixtures', () => {
  const res = classifyReply({ subject: 'Offer of Employment', body_snippet: 'We are pleased to offer you...' });
  assert.equal(res.type, 'Offer');
  assert.equal(res.suggestedTrackerUpdate, 'Offer');
});

test('classifyReply - rejection wins over offer substring (regression)', () => {
  // Regression: a rejection must never be typed as an Offer just because it contains
  // offer-ish wording. Previously the bare 'offer' keyword plus Offer-before-Rejected
  // ordering classified these as Offer and pushed a spurious Offer tracker update,
  // and made the 'unable to offer' rejection keyword dead code.

  // (a) "unable to offer" is a rejection, not an offer
  const a = classifyReply({ subject: '', body_snippet: 'Unfortunately, we are unable to offer you the position.' });
  assert.equal(a.type, 'Rejected');
  assert.equal(a.suggestedTrackerUpdate, 'Rejected');
  assert.ok(a.evidence.includes('unable to offer')); // previously-dead keyword now fires

  // (b) an explicit upstream rejection signal wins even when the body says "offer"
  const b = classifyReply({ signal: 'rejection', body_snippet: 'We cannot extend an offer at this time.' });
  assert.equal(b.type, 'Rejected');
  assert.equal(b.suggestedTrackerUpdate, 'Rejected');

  // (e) a rejection that still contains the specific 'offer letter' phrase — proves the
  //     reorder matters, not just removing the bare 'offer' keyword
  const e = classifyReply({ subject: '', body_snippet: 'Unfortunately, we will not be sending you an offer letter.' });
  assert.equal(e.type, 'Rejected');
  assert.equal(e.suggestedTrackerUpdate, 'Rejected');

  // (d) a plain rejection stays Rejected
  const d = classifyReply({ subject: '', body_snippet: "We've decided not to proceed." });
  assert.equal(d.type, 'Rejected');
  assert.equal(d.suggestedTrackerUpdate, 'Rejected');

  // (c) controls: genuine offers must still classify as Offer
  const c1 = classifyReply({ subject: '', body_snippet: 'We are pleased to send your offer letter.' });
  assert.equal(c1.type, 'Offer');
  assert.equal(c1.suggestedTrackerUpdate, 'Offer');

  const c2 = classifyReply({ signal: 'offer', body_snippet: '' });
  assert.equal(c2.type, 'Offer');
  assert.equal(c2.suggestedTrackerUpdate, 'Offer');
});

test('classifyReply - need action vs scheduling', () => {
  const actionRes = classifyReply({ subject: 'Please complete assessment test', body_snippet: '' });
  assert.equal(actionRes.type, 'Need Action');
  assert.equal(actionRes.suggestedTrackerUpdate, 'Responded');

  const scheduleRes = classifyReply({ subject: 'Please pick a time to schedule our interview', body_snippet: '' });
  assert.equal(scheduleRes.type, 'Need Action');
  assert.equal(scheduleRes.suggestedTrackerUpdate, 'Interview');
});

