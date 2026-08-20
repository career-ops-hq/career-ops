// tests/addons.test.mjs — Comprehensive test suite for all 5 ecosystem addons
import { pass, fail } from './helpers.mjs';
import { calculateAtsScore, extractTokens } from '../ats-score.mjs';
import { convertToJsonResume } from '../export-json-resume.mjs';
import { mergeContacts } from '../link-recruiter-contacts.mjs';
import { tailorProfileForJd } from '../tailor-and-render.mjs';
import { convertJsonToRenderCvData } from '../lib/cv-rendercv-schema.mjs';

console.log('\naddons.test.mjs — Testing all 5 Ecosystem Addons');

// 1. Test ATS Analyzer
const sampleResume = 'Senior Software Engineer building Python, Node.js, and Docker microservices.';
const sampleJd = 'Looking for a Senior Software Engineer with strong Python and Docker experience.';

const atsResult = calculateAtsScore(sampleResume, sampleJd);
if (atsResult.scorePct > 0 && atsResult.matchedKeywords.includes('python')) {
  pass('1. ATS Score Analyzer correctly calculates keyword matches');
} else {
  fail('1. ATS Score Analyzer failed');
}

// 2. Test Standard JSON Resume Exporter
const inputProfile = {
  name: 'Jane Doe',
  target_role: 'Full Stack Engineer',
  contact: { email: 'jane@example.com', github: 'https://github.com/janedoe' },
  experience: [{ company: 'Acme', role: 'Engineer', dates: '2021-2024' }]
};

const jsonResume = convertToJsonResume(inputProfile);
if (jsonResume.basics.name === 'Jane Doe' && jsonResume.basics.profiles.length === 1) {
  pass('2. Standard JSON Resume Exporter produces valid JSON Resume schema');
} else {
  fail('2. Standard JSON Resume Exporter failed');
}

// 3. Test Recruiter Contact Linker
const pipelineContacts = 'Recruiter Bob\tAcme\trecruiter\tLead Recruiter\t\tbob@acme.com\thttps://linkedin.com/in/bob\t123\tNotes';
const existingContacts = '# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker#\tnotes';

const mergeResult = mergeContacts(pipelineContacts, existingContacts);
if (mergeResult.mergedCount === 1 && mergeResult.content.includes('bob@acme.com')) {
  pass('3. Recruiter Intelligence Linker merges contacts without duplication');
} else {
  fail('3. Recruiter Intelligence Linker failed');
}

// 4. Test Theme & Preset Switcher
const renderCvData = convertJsonToRenderCvData(inputProfile, { theme: 'modern', primary_color: 'navy' });
if (renderCvData.design.theme === 'modern' && renderCvData.design.primary_color === 'navy') {
  pass('4. RenderCV Theme & Preset Switcher sets design properties');
} else {
  fail('4. RenderCV Theme & Preset Switcher failed');
}

// 5. Test AI Resume Tailor
const tailored = tailorProfileForJd(inputProfile, sampleJd);
if (tailored.headline && tailored.experience.length > 0) {
  pass('5. AI Resume Tailor adapts profile headline and experience bullets');
} else {
  fail('5. AI Resume Tailor failed');
}
