/**
 * reply-matcher.mjs — deterministic matcher that maps email reply candidates to application tracker entries.
 */

import { isPlaceholderCompany } from './lib/placeholder-cell.mjs';

export function extractDomain(emailStr) {
  if (!emailStr) return null;
  const match = emailStr.match(/@([\w.-]+)/);
  return match ? match[1].toLowerCase() : null;
}

export function normalizeStr(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '');
}

export function normalizeChinese(s) {
  return (s || '')
    .replace(/有限公司/g, '')
    .replace(/公司/g, '')
    .replace(/股份/g, '')
    .replace(/集团/g, '')
    .trim();
}

// A company value that carries no letter and no digit is a PLACEHOLDER, not a
// name: `?` is the documented marker for an unknown end employer (#1596), and a
// hand-edited row can hold the tracker's other no-data sentinels (`—`, `-`).
// Substring-matching those turns punctuation into a company signal — and since
// replies ask questions, `?` matched almost every mail, scoring 2, corroborating
// partial role matches, and reaching confidence `high` next to any
// post-application keyword.
// Definition in lib/placeholder-cell.mjs — it lived here and in
// process-quality.mjs, and a third reader of the same files had neither.

// Short names must land on a word boundary. The normalized check further down
// has always required more than two characters, but the two substring checks
// above it had no floor at all, so `HP` matched the word `PHP`. A boundary
// keeps the short names that are real — HP, 3M, IBM — while refusing the ones
// that merely occur inside a longer word.
const SHORT_NAME_MAX = 3;

// ...but only where a word boundary can exist. Chinese and Japanese run without
// separators, so every neighbour of a name is itself a letter and the boundary
// NEVER holds — requiring one would refuse `腾讯` inside `我们是腾讯的招聘团队`,
// and two-character names are the norm in those scripts. They keep the
// substring path and the normalizeChinese() handling written for them below.
//
// Hangul is deliberately NOT here. Korean orthography separates words with
// spaces (띄어쓰기), so the boundary holds for it exactly as it does for Latin —
// listing it would have waived the guard for no gain, letting a short Korean
// name match inside a longer word, which is the very bug this rule exists to
// stop. Found because the test asked for it never failed when Hangul was
// removed (CodeRabbit, #3001).
const NO_WORD_SEPARATOR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

// \p{M} sits alongside \p{L}/\p{N} in both lookarounds so a combining mark counts
// as part of a word rather than as a boundary. Without it, "data" matches inside
// "datá" — the mark belongs to the preceding base letter, so that is the middle
// of a word, not the end of one. This has to agree with LATIN_WORD_RE: a needle
// allowed to CONTAIN marks needs boundaries that treat marks as word material,
// or the two halves of the rule disagree about where a word ends.
function matchesOnWordBoundary(text, company) {
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, 'iu').test(text);
}

export function checkCompanyMatch(text, company) {
  if (!company || !text) return false;
  if (isPlaceholderCompany(company)) return false;

  // A short name is decided by the boundary test alone: falling through to the
  // substring checks below would reinstate the very match it just refused.
  // Length is counted in CODE POINTS — `String.length` counts UTF-16 units, so a
  // three-character supplementary-plane name reported 4 and slipped past the
  // threshold into the substring path its BMP equivalent was refused.
  const alphanumeric = company.replace(/[^\p{L}\p{N}]/gu, '');
  const isShortName = Array.from(alphanumeric).length <= SHORT_NAME_MAX;
  if (isShortName && !NO_WORD_SEPARATOR_RE.test(company)) {
    return matchesOnWordBoundary(text, company);
  }

  // Exact substring
  if (text.includes(company)) return true;
  
  const textLower = text.toLowerCase();
  const compLower = company.toLowerCase();
  
  if (textLower.includes(compLower)) return true;

  // Ignore spacing
  const tNorm = normalizeStr(text);
  const cNorm = normalizeStr(company);
  if (cNorm.length > 2 && tNorm.includes(cNorm)) return true;

  // Chinese names normalisation
  const cChi = normalizeChinese(company);
  if (cChi && cChi.length >= 2 && text.includes(cChi)) return true;

  return false;
}

// Generic recruiting/HR vocabulary. These words are common enough in unrelated
// senders' signatures, job titles, and boilerplate (e.g. "Talent Acquisition &
// Diversity" in a recruiter's signature for a *different* company/role) that
// they must never, by themselves, count as a "significant word" match against
// a tracker role title — regardless of length (see #2671).
const GENERIC_ROLE_WORDS = new Set([
  'talent', 'acquisition', 'specialist', 'coordinator', 'operations',
  'recruiter', 'recruiting', 'human', 'resources', 'people'
]);

// Matches any CJK ideograph. Chinese role titles are normally written with no
// whitespace/underscore separators at all ("python开发工程师" is one semantic
// phrase, not one "word"), so the single-word rule below must not treat them
// as a bare single word the way it does for Latin-script titles.
const CJK_RE = /[一-鿿㐀-䶿]/;

// A role word the whole-word rule in checkRoleMatch() may safely be applied to:
// Latin letters and digits only. Anything else keeps the substring test it had
// before, because "does a word boundary exist here" has no script-independent
// answer — see the comment at the call site.
// \p{M} is load-bearing, not defensive. toLowerCase() can introduce a combining
// mark that is NOT Script=Latin: "İ" (U+0130) becomes "i" + U+0307, and U+0307
// is \p{M} with Script=Inherited. Without \p{M} here, "İstatistik" fails this
// gate, falls to the substring path, and matches inside "İstatistikler" — the
// bug this rule exists to remove, still live for Turkish. The same applies to
// any NFD-decomposed accented text, so it reaches French, Spanish, Portuguese
// and Vietnamese too, not just Turkish (CodeRabbit, #3535).
//
// It does not widen the gate to other scripts: a Devanagari or Thai word still
// fails on its base letters, which are not Script=Latin.
const LATIN_WORD_RE = /^[\p{Script=Latin}\p{M}\p{N}]+$/u;

// Ceiling on the needle handed to matchesOnWordBoundary() from checkRoleMatch().
//
// That helper builds `new RegExp(..., 'iu')`, and V8's compiler stack-overflows
// on a case-insensitive Unicode pattern once the literal needle is long enough
// — it THROWS at construction rather than failing to match, and the throw
// propagates uncaught out through matchCandidates() and into reply-watch. The
// exact limit is build- and content-dependent (a repeating "WordWord…" run
// blows up well before a single repeated character does), so this is set far
// below any observed threshold rather than tuned to one.
//
// checkCompanyMatch, the helper's only other caller, cannot reach this: it is
// gated by isShortName to names of SHORT_NAME_MAX characters. A role-title part
// has no such ceiling, which is what makes the ceiling explicit here.
//
// 128 is far longer than any real single role word — the longest in a job title
// is a German compound in the 40s — so nothing legitimate is turned away. A
// part above it is malformed data (a JD pasted into the role field, a merged
// CSV column) and falls through to the substring test, exactly as on main.
//
// The check must be on `bare`, not on the part it came from: toLowerCase() can
// LENGTHEN a string, so `bare` is not simply a shorter subset. "İ" (U+0130)
// lowercases to "i" plus a combining dot, and a part of 100 of them yields a
// bare of 199 — nearly 2x. The margin here absorbs that regardless (reaching a
// crash-length needle would still need a part in the thousands, which this
// rejects either way), but measuring the string that actually reaches the regex
// is the property worth holding onto.
const MAX_BOUNDARY_NEEDLE = 128;

// A role title that reduces to a single word — whether that word is generic
// recruiting vocabulary ("Recruiter") or a specific one ("Engineer") — is not
// specific enough to stand alone as an "exact" match: checking it as a whole-
// role substring degenerates into exactly the same bare-word check the
// corroboration requirement exists to gate. Such roles fall through to the
// partial-match path in checkRoleMatch(), which requires company/domain
// corroboration in matchCandidates(). Chinese compound titles are exempted:
// they carry no separators to split on, so "single part" doesn't mean
// "single word" for them.
function isSingleWordRole(role) {
  const parts = role.split(/[\s_\\/()-]+/).filter(Boolean);
  return parts.length === 1 && !CJK_RE.test(parts[0]);
}

// True only when the *entire* role title (or its Chinese, symbol-stripped form)
// appears in the text as one contiguous substring. This is specific enough to
// stand on its own, with no need for a corroborating company/domain signal —
// unless the role is nothing but a single word (see isSingleWordRole).
export function checkRoleMatchExact(text, role) {
  if (!role || !text) return false;
  if (isSingleWordRole(role)) return false;

  const tNorm = normalizeStr(text);
  const rNorm = normalizeStr(role);
  // A whitespace-only role normalizes to '' (normalizeStr strips whitespace),
  // and String.prototype.includes('') is always true — without this guard a
  // blank role would "exactly" match any text at all, bypassing corroboration
  // entirely. isSingleWordRole doesn't catch this: splitting a whitespace-only
  // string on separators yields zero parts, not one.
  if (!rNorm) return false;
  if (tNorm.includes(rNorm)) return true;

  // Handle Chinese role titles ignoring symbols
  const cleanRole = role.replace(/[\s_\\/()-]+/g, '');
  if (cleanRole.length > 2 && tNorm.includes(cleanRole.toLowerCase())) return true;

  return false;
}

export function checkRoleMatch(text, role) {
  if (!role || !text) return false;

  if (checkRoleMatchExact(text, role)) return true;

  const tNorm = normalizeStr(text);

  // Sometimes role has extra descriptors, we check if a significant part matches
  // Like "PY01_python开发工程师" vs "python开发工程师". Generic recruiting words
  // (see GENERIC_ROLE_WORDS) are excluded no matter how long they are — a bare
  // "Talent" or "Specialist" match is exactly the false-positive pattern from
  // #2671, not evidence of a real match.
  // Note tNorm is used only by the substring branch below. The whole-word branch
  // tests the RAW text, because normalizeStr strips all whitespace and a
  // boundary rule needs the delimiters intact — there is nothing left to anchor
  // to once every character is adjacent to another.
  const roleParts = role.split(/[\s_\\/()-]+/);
  for (const part of roleParts) {
    if (part.length <= 3) continue;

    // Splitting on [\s_\\/()-]+ leaves attached punctuation behind ("Director,"
    // keeps its comma), which both defeats a boundary anchor and, before this,
    // defeated the substring test outright — "director," is not in the text.
    // Two forms, deliberately. `stripped` keeps its case and is what reaches the
    // matcher; `bare` is lowercased and is only ever read by the gates below.
    //
    // Lowercasing the needle would be worse than redundant. matchesOnWordBoundary
    // is already case-insensitive ('iu'), and the two mechanisms disagree:
    // toLowerCase() applies FULL case mapping, which turns "İ" into "i" + U+0307,
    // while the regex 'i' flag uses SIMPLE case folding, under which "İ" does not
    // fold to that pair. Hand it the lowercased form and the needle is decomposed
    // while the text is composed, so a genuine mention can never match.
    // \p{M} belongs in this class for the same reason it belongs in the gate and
    // in both lookarounds: a combining mark is word material, not punctuation to
    // peel off. Without it, an NFD word ENDING in a mark loses it — "Chargé" as
    // e+U+0301 strips to "Charge" — and the boundary test then correctly refuses
    // the result, because the mark still sitting in the text makes that position
    // mid-grapheme. The word stops matching itself.
    //
    // Three predicates define "word material" here (this strip, LATIN_WORD_RE,
    // and matchesOnWordBoundary's lookarounds) and they have to move as a unit.
    // Updating two of the three is what produced that bug (CodeRabbit, #3535).
    const stripped = part.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
    const bare = stripped.toLowerCase();

    // The whole-word requirement applies to Latin-script parts ONLY, and every
    // other script keeps the substring test it had before — including the gates
    // above it, which is why the routing happens HERE and not before `bare` is
    // consulted. Stripping punctuation can push a part under the length gate:
    // "工程师。" is four characters and three without the ideographic period, so
    // gating on the stripped form would silently drop three-character Chinese
    // titles that main matches. Non-Latin parts are therefore judged on `part`,
    // exactly as before; only the Latin branch looks at `bare`.
    //
    // #3455 is a bug about English boilerplate — "Analytic" matching inside
    // "Analytics" — and "which scripts have word boundaries" turns out to be
    // the wrong question to answer in order to fix it. It has no clean answer:
    // Japanese runs without separators in all three of its scripts, while
    // Korean DOES separate words with spaces but glues grammatical particles
    // straight onto the noun ("개발자" + "를" -> "개발자를"), so a boundary rule
    // silently stops matching a genuinely mentioned Korean title. Both of those
    // were real false negatives in earlier drafts of this fix, found one script
    // at a time — which is the argument for not enumerating scripts at all.
    //
    // Restricting the stricter rule to Latin fixes the reported bug and leaves
    // every other script byte-identical to its previous behaviour.
    if (!LATIN_WORD_RE.test(bare) || stripped.length > MAX_BOUNDARY_NEEDLE) {
      // Deliberately the raw `part`, mirroring the pre-existing condition
      // exactly. Every word in GENERIC_ROLE_WORDS is pure Latin and would have
      // routed to the branch below, so this can never fire here — it is kept so
      // the two paths can be read as "unchanged" and "new" rather than
      // diffed for silent omissions.
      if (!GENERIC_ROLE_WORDS.has(part.toLowerCase()) && tNorm.includes(normalizeStr(part))) return true;
      continue;
    }

    // Latin branch only: re-apply the length and generic-word gates to the
    // stripped form, so "AI!!" is not four characters of significance and
    // "Recruiter," cannot slip past the #2671 blocklist on its comma.
    if (bare.length <= 3 || GENERIC_ROLE_WORDS.has(bare)) continue;

    // Reuse the company-name boundary helper rather than a second copy of the
    // same rule: it already escapes the needle and anchors on \p{L}/\p{N}
    // lookarounds instead of \b, which is what this needs. \b would be wrong in
    // both directions — a CJK ideograph is not \w, so \b reports a boundary and
    // matches "data" inside "data工程师"; while "_" IS \w, so \b reports none
    // and misses "data_engineer", though "_" is one of the separators the role
    // title itself is split on.
    if (matchesOnWordBoundary(text, stripped)) {
      return true; // partial match on a significant word
    }
  }

  return false;
}

// Shared ATS, job board, and webmail hosts. Mail from one of these identifies a
// vendor, never an employer, so it must never become a candidate domain: every
// message from the host would then score a sender-domain match against whichever
// application happened to mention it.
const SHARED_DOMAINS = [
  'linkedin.com',
  'applytojob.com',
  'greenhouse.io',
  'lever.co',
  'icims.com',
  'myworkday.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'taleo.net',
  'successfactors.com',
  'gmail.com',
  'outlook.com',
  'yahoo.com',
  'hotmail.com'
];

// Dot-separated labels ending in a letters-only TLD. Rejects the shapes tracker
// prose produces: sentence-final words ("gaps."), bare numerics ("3.34.5."), and
// paths or filenames ("output/cv-2026-06-23.pdf").
const DOMAIN_SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

// Extensions of the artifacts career-ops writes into tracker notes. Several parse
// as a valid TLD, so shape alone cannot tell a filename from a hostname: "cv.md"
// would otherwise read as a Moldovan domain. Deliberately excludes extensions that
// are common employer TLDs (io, co, ai, sh, me, dev, app).
const FILE_EXTENSIONS = [
  'pdf', 'md', 'doc', 'docx', 'txt', 'html', 'htm',
  'png', 'jpg', 'jpeg', 'csv', 'tsv', 'json', 'yaml', 'yml', 'mjs'
];

function isUsableDomain(domain) {
  if (!DOMAIN_SHAPE.test(domain)) return false;
  if (FILE_EXTENSIONS.includes(domain.slice(domain.lastIndexOf('.') + 1))) return false;
  return !SHARED_DOMAINS.some(shared => domain === shared || domain.endsWith(`.${shared}`));
}

function addDomain(domains, value) {
  const domain = (value || '').toLowerCase();
  if (isUsableDomain(domain)) domains.add(domain);
}

export function getAppDomains(app, followups) {
  const domains = new Set();
  
  // Extract from notes
  if (app.notes) {
    const emails = app.notes.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
    for (const email of emails) {
      addDomain(domains, extractDomain(email));
    }
    // Also look for explicit domains in notes (e.g. "ATS: lever.co")
    const words = app.notes.split(/\s+/);
    for (const w of words) {
      if (w.includes('.') && !w.includes('@')) {
        // Notes are prose, so trim the punctuation wrapping the token rather than
        // deleting every disallowed character: dropping "/" would splice a path
        // like "output/cv-2026-06-23.pdf" into one plausible-looking hostname.
        addDomain(domains, w.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, ''));
      }
    }
  }

  // Followups
  const appFollowups = followups.filter(f => f.appNum === app.num);
  for (const fu of appFollowups) {
    if (fu.contact) {
      addDomain(domains, extractDomain(fu.contact));
    }
    if (fu.notes) {
       const emails = fu.notes.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
       for (const email of emails) {
         addDomain(domains, extractDomain(email));
       }
    }
  }

  // Add common company domain guess (companyname.com). "?" is the structural
  // marker for a confidential employer, not a name, so there is nothing to guess.
  const cNorm = normalizeStr(app.company);
  if (cNorm && cNorm !== '?') {
    addDomain(domains, `${cNorm}.com`);
    addDomain(domains, `${cNorm}.co`);
    addDomain(domains, `${cNorm}.io`);
  }

  return Array.from(domains);
}

export function matchCandidates(candidates, apps, followups = []) {
  const results = [];
  
  for (const cand of candidates) {
    const textContext = `${cand.from || ''} ${cand.subject || ''} ${cand.body_snippet || ''}`;
    const fromDomain = extractDomain(cand.from);
    
    let bestMatches = [];
    let highestScore = -1;
    
    for (const app of apps) {
      let score = 0;
      let signals = [];
      let companyHint = '';
      let roleHint = '';
      
      const isCompanyMatch = checkCompanyMatch(textContext, app.company);
      if (isCompanyMatch) {
        score += 2;
        signals.push('company-name');
        companyHint = app.company;
      }

      let hasDomainMatch = false;
      if (fromDomain) {
        const appDomains = getAppDomains(app, followups);
        if (appDomains.some(d => fromDomain === d || fromDomain.endsWith(`.${d}`))) {
          hasDomainMatch = true;
          score += 2;
          signals.push('sender-domain');
          companyHint = companyHint || app.company;
        }
      }

      // A role match on the *entire* role title is specific enough to stand on
      // its own. A match on just one "significant word" of the role (e.g. the
      // role split into descriptor parts) is not — those partial matches must be
      // corroborated by a company-name or sender-domain signal, otherwise a
      // generic multi-word title (e.g. "Talent Acquisition Specialist") lets any
      // unrelated email that happens to contain one of those words falsely
      // attribute itself to this application (#2671).
      const isRoleExactMatch = checkRoleMatchExact(textContext, app.role);
      const isRolePartialMatch = !isRoleExactMatch && checkRoleMatch(textContext, app.role);
      const isRoleMatch = isRoleExactMatch || (isRolePartialMatch && (isCompanyMatch || hasDomainMatch));
      if (isRoleMatch) {
        score += 1.5;
        signals.push('role-title');
        roleHint = app.role;
      }

      const postAppKeywords = ['interview', 'offer', 'rejection', '邀您面试', '简历通过', 'next steps', 'update on your application'];
      const strongSignals = ['interview_invite', 'offer', 'rejection'];
      const hasPostAppKeyword = (cand.signal && strongSignals.includes(cand.signal)) 
        || postAppKeywords.some(k => textContext.toLowerCase().includes(k.toLowerCase()));
      
      if (hasPostAppKeyword && (isCompanyMatch || hasDomainMatch)) {
         signals.push('post-application-keyword');
      }

      if (score > 0) {
        let confidence = 'low';
        if ((isCompanyMatch || hasDomainMatch) && isRoleMatch) {
          confidence = 'high';
        } else if ((isCompanyMatch || hasDomainMatch) && hasPostAppKeyword) {
          confidence = 'high';
        } else if (isCompanyMatch || hasDomainMatch) {
          confidence = 'medium';
        } else if (isRoleMatch) {
          confidence = 'low';
        }
        
        const matchInfo = {
          message_id: cand.message_id,
          company_hint: companyHint || app.company,
          role_hint: roleHint || app.role,
          application_num: app.num,
          confidence,
          signals: Array.from(new Set(signals)),
          score
        };
        
        if (score > highestScore) {
          highestScore = score;
          bestMatches = [matchInfo];
        } else if (score === highestScore) {
          bestMatches.push(matchInfo);
        }
      }
    }
    
    if (bestMatches.length === 1) {
      const match = bestMatches[0];
      delete match.score;
      results.push(match);
    } else if (bestMatches.length > 1) {
      // Ambiguous matches
      results.push({
        message_id: cand.message_id,
        company_hint: cand.from,
        role_hint: '',
        application_num: null, // ambiguous
        confidence: 'low',
        signals: ['ambiguous-match'],
      });
    } else {
      // No matches
      results.push({
        message_id: cand.message_id,
        company_hint: fromDomain || cand.from,
        role_hint: '',
        application_num: null,
        confidence: 'low',
        signals: ['no-match']
      });
    }
  }
  
  return results;
}

export function classifyReply(cand) {
  const subject = cand.subject || '';
  const body = cand.body_snippet || '';
  const text = `${cand.from || ''} ${subject} ${body}`;
  const textLower = text.toLowerCase();
  const signal = cand.signal || '';

  const evidence = [];

  // Define keyword match helper (case-insensitive)
  const check = (keywords) => {
    let found = false;
    for (const kw of keywords) {
      if (textLower.includes(kw.toLowerCase())) {
        evidence.push(kw);
        found = true;
      }
    }
    return found;
  };

  // 1. Noise keywords (checked first to separate alerts/leads from actual interviews)
  const noiseKeywords = [
    '邀请投递', '抢面试先机', '近期热招', '立即投递', '热招职位', '订阅职位', '职位推荐', '推荐职位',
    'job alert', 'invitation to apply', 'recommended jobs', 'newsletter', 'marketing digest', 'job recommendation', 'suggested jobs'
  ];

  // 2. Offer keywords — specific phrases only. A bare 'offer' substring is deliberately
  //    excluded: it collides with rejection wording such as 'unable to offer' (see
  //    rejectionKeywords) and would mis-type rejections as offers.
  const offerKeywords = [
    '录取通知书', '录用信', '录用通知', '录用', '薪资确认', '入职协议', '意向书',
    'offer letter', 'employment agreement', 'job offer', 'congratulations on the offer', 'compensation details', 'pleased to offer'
  ];

  // 3. Rejected keywords
  const rejectionKeywords = [
    '很遗憾', '暂不匹配', '不合适', '未能进入下一轮', '感谢您的时间', '未通过', '不再考虑', '决定不推进',
    'unfortunately', 'not a match', 'not matching', 'decided not to proceed', 'will not be moving forward', 'position has been filled', 'role has been closed', 'unable to offer'
  ];

  // 4. Auto-confirmation keywords
  const autoKeywords = [
    '自动回复', '收到您的申请', '申请已收到', '投递成功', '确认收到',
    'thank you for applying', 'application received', 'received your application', 'auto-confirmation', 'confirmation of application', 'automatic reply'
  ];

  // 5. Need Action keywords
  const actionKeywords = [
    '补充信息', '提供信息', '完成测评', '在线测评', '笔试题', '做个测试', '截止日期前', '截止时间',
    'complete a form', 'provide information', 'finish an assessment', 'coding challenge', 'online test', 'respond by a deadline', 'pick a time', 'schedule a time', 'book a time',
    'complete assessment', 'take a test', 'assessment', 'coding test', 'deadline', 'fill out', 'complete the form', 'provide details', 'submit info'
  ];

  // 6. Interview keywords
  const interviewKeywords = [
    '邀您面试', '邀约面试', '微信小程序面试', 'AI微信小程序', '面试形式', '面试时间', '面试时长', '安排面试', '预约面试', '首轮面试', '视频面试', '电话面试', '现场面试', '面试邀请', '面试流程', '简历通过',
    'interview invitation', 'schedule an interview', 'scheduling link', 'ai interview', 'video interview', 'phone screen', 'onsite interview', 'final round', 'invite you to interview', 'interview request', 'interview schedule'
  ];

  // 7. Responded keywords
  const respondedKeywords = [
    '联系您', '回复您', '想沟通', '想聊聊', '进一步沟通',
    'would like to chat', 'reach out', 'connect with you', 'hiring manager responded'
  ];

  const isNoise = check(noiseKeywords);
  if (isNoise) {
    return {
      type: 'Noise',
      evidence: Array.from(new Set(evidence)),
      suggestedTrackerUpdate: 'none'
    };
  }

  // Rejection is decided before Offer: an explicit rejection signal or rejection
  // wording (e.g. 'unable to offer', or 'we will not be sending an offer letter'
  // which still contains the 'offer letter' phrase) must win even when offer-ish
  // phrasing is present. Deciding Offer first would type such replies as Offer and
  // push a spurious Offer tracker update.
  const hasRejectionKeywords = check(rejectionKeywords);
  const isRejected = signal === 'rejection' || hasRejectionKeywords;
  if (isRejected) {
    if (signal === 'rejection' && !evidence.includes('rejection')) evidence.push('rejection');
    return {
      type: 'Rejected',
      evidence: Array.from(new Set(evidence)),
      suggestedTrackerUpdate: 'Rejected'
    };
  }

  const hasOfferKeywords = check(offerKeywords);
  const isOffer = signal === 'offer' || hasOfferKeywords;
  if (isOffer) {
    if (signal === 'offer' && !evidence.includes('offer')) evidence.push('offer');
    return {
      type: 'Offer',
      evidence: Array.from(new Set(evidence)),
      suggestedTrackerUpdate: 'Offer'
    };
  }

  const isAuto = check(autoKeywords);
  if (isAuto) {
    return {
      type: 'Auto-confirmation',
      evidence: Array.from(new Set(evidence)),
      suggestedTrackerUpdate: 'none'
    };
  }

  const isAction = check(actionKeywords);
  if (isAction) {
    const hasSchedulingWording = textLower.includes('schedule') || textLower.includes('pick a time') || textLower.includes('book a time') || textLower.includes('book a slot') ||
                                 textLower.includes('choose a time') || textLower.includes('select a time') || textLower.includes('appointment') ||
                                 text.includes('预约') || text.includes('选择时间') || text.includes('选择面试') || text.includes('安排时间');
    return {
      type: 'Need Action',
      evidence: Array.from(new Set(evidence)),
      suggestedTrackerUpdate: hasSchedulingWording ? 'Interview' : 'Responded'
    };
  }

  const hasInterviewKeywords = check(interviewKeywords);
  const isInterview = signal === 'interview_invite' || hasInterviewKeywords;
  if (isInterview) {
    if (signal === 'interview_invite' && !evidence.includes('interview_invite')) evidence.push('interview_invite');
    return {
      type: 'Interview',
      evidence: Array.from(new Set(evidence)),
      suggestedTrackerUpdate: 'Interview'
    };
  }

  const hasRespondedKeywords = check(respondedKeywords);
  const isResponded = signal === 'update' || hasRespondedKeywords;
  if (isResponded) {
    if (signal === 'update' && !evidence.includes('update')) evidence.push('update');
    return {
      type: 'Responded',
      evidence: Array.from(new Set(evidence)),
      suggestedTrackerUpdate: 'Responded'
    };
  }

  const recruitingTerms = [
    'application', 'career', 'job', 'recruiter', 'hiring', 'interview', 'resume',
    '简历', '职位', '招聘', '应聘'
  ];
  const isRecruiting = recruitingTerms.some(term => textLower.includes(term.toLowerCase()));
  if (isRecruiting) {
    return {
      type: 'Unknown',
      evidence: [],
      suggestedTrackerUpdate: 'Needs Review'
    };
  }

  return {
    type: 'Unknown',
    evidence: [],
    suggestedTrackerUpdate: 'Needs Review'
  };
}

