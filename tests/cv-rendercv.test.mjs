// tests/cv-rendercv.test.mjs — Test RenderCV schema conversion and builder
import { pass, fail } from './helpers.mjs';
import { convertJsonToRenderCvData, convertJsonToRenderCvYaml } from '../lib/cv-rendercv-schema.mjs';

console.log('\ncv-rendercv.test.mjs — RenderCV schema conversion & builder');

const SAMPLE_PAYLOAD = {
  name: 'Alex Chen',
  target_role: 'Senior ML Engineer',
  contact: {
    email: 'alex@example.com',
    location: 'Austin, TX',
    linkedin: 'https://linkedin.com/in/alexchen',
    github: 'https://github.com/alexchen',
    website: 'alexchen.dev'
  },
  summary: [
    'Full-stack AI engineer with 6 years building production ML systems.'
  ],
  experience: [
    {
      company: 'TechFin Corp',
      role: 'Senior ML Engineer',
      location: 'Austin, TX',
      dates: '2020 - 2024',
      bullets: [
        'Led ML platform team of 3 engineers',
        'Designed real-time fraud detection pipeline'
      ]
    }
  ],
  education: [
    {
      institution: 'UT Austin',
      degree: 'MS Computer Science',
      dates: '2018'
    }
  ],
  skills: [
    {
      category: 'Languages',
      items: ['Python', 'Go', 'TypeScript', 'SQL']
    }
  ]
};

// 1. Check data conversion
const data = convertJsonToRenderCvData(SAMPLE_PAYLOAD);

if (data.cv.name === 'Alex Chen') pass('Converts name correctly');
else fail(`Expected 'Alex Chen', got '${data.cv.name}'`);

if (data.cv.headline === 'Senior ML Engineer') pass('Converts headline/target_role correctly');
else fail(`Expected 'Senior ML Engineer', got '${data.cv.headline}'`);

if (data.cv.email === 'alex@example.com') pass('Converts email correctly');
else fail(`Expected 'alex@example.com', got '${data.cv.email}'`);

if (data.cv.website === 'https://alexchen.dev') pass('Normalizes website URL scheme');
else fail(`Expected 'https://alexchen.dev', got '${data.cv.website}'`);

if (data.cv.sections.experience && data.cv.sections.experience.length === 1) {
  pass('Converts experience section');
  const exp = data.cv.sections.experience[0];
  if (exp.company === 'TechFin Corp' && exp.position === 'Senior ML Engineer') {
    pass('Experience company and position mapped');
  } else {
    fail(`Experience mapping mismatch: ${JSON.stringify(exp)}`);
  }
} else {
  fail('Experience section missing or empty');
}

// 2. Check YAML generation
const yamlStr = convertJsonToRenderCvYaml(SAMPLE_PAYLOAD);

if (yamlStr.includes('name: Alex Chen') && yamlStr.includes('TechFin Corp')) {
  pass('Generates valid RenderCV YAML string');
} else {
  fail('YAML output missing expected content');
}
