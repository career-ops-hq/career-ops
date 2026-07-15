import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  extractDomain, 
  checkCompanyMatch, 
  checkRoleMatch, 
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

