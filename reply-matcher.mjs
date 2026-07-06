/**
 * reply-matcher.mjs — deterministic matcher that maps email reply candidates to application tracker entries.
 */

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

export function checkCompanyMatch(text, company) {
  if (!company || !text) return false;
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

export function checkRoleMatch(text, role) {
  if (!role || !text) return false;
  
  const tNorm = normalizeStr(text);
  const rNorm = normalizeStr(role);
  if (tNorm.includes(rNorm)) return true;

  // Sometimes role has extra descriptors, we check if a significant part matches
  // Like "PY01_python开发工程师" vs "python开发工程师"
  const roleParts = role.split(/[\s_\\/()-]+/);
  for (const part of roleParts) {
    if (part.length > 3 && tNorm.includes(normalizeStr(part))) {
      return true; // partial match on a significant word
    }
  }

  // Handle Chinese role titles ignoring symbols
  const cleanRole = role.replace(/[\s_\\/()-]+/g, '');
  if (cleanRole.length > 2 && tNorm.includes(cleanRole.toLowerCase())) return true;
  
  return false;
}

export function getAppDomains(app, followups) {
  const domains = new Set();
  
  // Extract from notes
  if (app.notes) {
    const emails = app.notes.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
    for (const email of emails) {
      const d = extractDomain(email);
      if (d) domains.add(d);
    }
    // Also look for explicit domains in notes (e.g. "ATS: lever.co")
    const words = app.notes.split(/\s+/);
    for (const w of words) {
      if (w.includes('.') && !w.includes('@')) {
        // very rough domain check
        domains.add(w.toLowerCase().replace(/[^a-z0-9.-]/g, ''));
      }
    }
  }

  // Followups
  const appFollowups = followups.filter(f => f.appNum === app.num);
  for (const fu of appFollowups) {
    if (fu.contact) {
      const d = extractDomain(fu.contact);
      if (d) domains.add(d);
    }
    if (fu.notes) {
       const emails = fu.notes.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
       for (const email of emails) {
         const d = extractDomain(email);
         if (d) domains.add(d);
       }
    }
  }

  // Add common company domain guess (companyname.com)
  const cNorm = normalizeStr(app.company);
  if (cNorm) {
    domains.add(`${cNorm}.com`);
    domains.add(`${cNorm}.co`);
    domains.add(`${cNorm}.io`);
  }

  return Array.from(domains).filter(Boolean);
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
      
      const isRoleMatch = checkRoleMatch(textContext, app.role);
      if (isRoleMatch) {
        score += 1.5;
        signals.push('role-title');
        roleHint = app.role;
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
