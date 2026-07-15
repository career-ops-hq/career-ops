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

  // 2. Offer keywords
  const offerKeywords = [
    '录取通知书', '录用信', '录用通知', '录用', '薪资确认', '入职协议', '意向书',
    'offer letter', 'employment agreement', 'job offer', 'congratulations on the offer', 'compensation details', 'offer'
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

