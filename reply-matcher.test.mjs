import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDomain,
  checkCompanyMatch,
  checkRoleMatch,
  getAppDomains,
  matchCandidates,
  classifyReply
} from './reply-matcher.mjs';

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

test('getAppDomains - drops prose tokens and filenames, keeps real hostnames', () => {
  const app = {
    num: 68,
    company: 'Northwind',
    role: 'VP, Demand Generation',
    notes: 'Near-bullseye remote VP-DG at enterprise SaaS; no hard blockers (MBA/vertical-pod soft gaps).; Applied via careers.northwind.com, Remote-US. Comp expectation submitted before the screen. CV: output/cv-vp-demand-generation-2026-06-23.pdf'
  };

  const domains = getAppDomains(app, []);

  assert.ok(domains.includes('northwind.com'), 'company-domain guess must survive');
  assert.ok(domains.includes('careers.northwind.com'), 'employer subdomain in notes must survive');
  for (const junk of ['gaps.', 'remote-us.', 'screen.', 'outputcv-vp-demand-generation-2026-06-23.pdf']) {
    assert.ok(!domains.includes(junk), `expected junk token "${junk}" to be dropped`);
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

  assert.ok(domains.includes('franchise-search.example'), 'employer contact domain must survive');
  for (const junk of ['client.', 'location-tied.', 'directly.', '?.com', '?.co', '?.io']) {
    assert.ok(!domains.includes(junk), `expected junk token "${junk}" to be dropped`);
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

  assert.ok(domains.includes('talent-partners.example'), 'recruiter contact domain must survive');
  for (const junk of ['3.34.5.', 'talentpartners.', 'searches.', '?.com', '?.co', '?.io']) {
    assert.ok(!domains.includes(junk), `expected junk token "${junk}" to be dropped`);
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

  assert.ok(domains.includes('initech.com'), 'company-domain guess must survive');
  assert.ok(domains.includes('initech-group.example'), 'employer contact domain must survive');
  for (const filename of ['cv.md', 'article-digest.md', 'cover-letter.pdf']) {
    assert.ok(!domains.includes(filename), `expected filename "${filename}" to be dropped`);
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

  assert.ok(domains.includes('globex.com'), 'company-domain guess must survive');
  assert.ok(domains.includes('globex-hq.example'), 'employer contact domain in notes must survive');
  for (const shared of ['linkedin.com', 'greenhouse.io', 'gmail.com', 'outlook.com', 'myworkday.com']) {
    assert.ok(!domains.includes(shared), `expected shared domain "${shared}" to be dropped`);
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

test('classifyReply - need action vs scheduling', () => {
  const actionRes = classifyReply({ subject: 'Please complete assessment test', body_snippet: '' });
  assert.equal(actionRes.type, 'Need Action');
  assert.equal(actionRes.suggestedTrackerUpdate, 'Responded');

  const scheduleRes = classifyReply({ subject: 'Please pick a time to schedule our interview', body_snippet: '' });
  assert.equal(scheduleRes.type, 'Need Action');
  assert.equal(scheduleRes.suggestedTrackerUpdate, 'Interview');
});

