const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** Build neutral bilingual profile data for layout-only regression tests. */
function base(lang, withPhoto) {
  const zh = lang === 'zh-CN';
  return {
    lang,
    page_format: 'a4',
    candidate: {
      name: zh ? '林知远' : 'Jordan Lee',
      phone: '+1 555 010 2048',
      email: 'candidate@example.com',
      linkedin: { url: 'https://linkedin.com/in/candidate', display: 'linkedin.com/in/candidate' },
      portfolio: { url: 'https://candidate.example.com', display: 'candidate.example.com' },
      location: zh ? '中国｜杭州' : 'Toronto, Canada',
      photo: withPhoto ? PIXEL : '',
      photo_style: withPhoto ? 'circle' : 'rounded',
    },
    sections: zh ? {
      summary: '个人简介', competencies: '核心能力', experience: '工作经历', projects: '精选项目',
      education: '教育经历', certifications: '专业认证', skills: '技术能力',
    } : undefined,
    summary: zh
      ? '视觉布局测试专用的示例简介，不代表任何真实候选人的经历或能力。'
      : 'Sample summary for visual layout testing; it does not describe a real candidate.',
    competencies: zh
      ? ['示例能力甲', '示例能力乙', '示例能力丙', '示例能力丁']
      : ['Sample Competency A', 'Sample Competency B', 'Sample Competency C', 'Sample Competency D'],
    experience: [],
    projects: [],
    education: [{ title: zh ? '示例学位' : 'Example Degree', org: zh ? '示例院校' : 'Example Institution', year: '2025' }],
    certifications: [{ title: zh ? '示例认证' : 'Example Certificate', org: zh ? '示例机构' : 'Example Organization', year: '2025' }],
    skills: [{ category: zh ? '示例技能' : 'Sample Skills', items: zh ? ['工具甲', '工具乙', '工具丙', '工具丁', '工具戊'] : ['Tool A', 'Tool B', 'Tool C', 'Tool D', 'Tool E'] }],
  };
}

/** Build one neutral experience entry, expanding bullets for dense fixtures. */
function role(i, zh, dense) {
  const bullets = zh
    ? [
        '示例职责描述甲，用于验证较长中文文本在工作经历区域中的自动换行和间距。',
        '示例职责描述乙，用于验证列表符号、行高以及连续条目之间的视觉关系。',
        '示例职责描述丙，仅作为结构占位文本，不代表任何真实经验、技术或成果。',
        '示例职责描述丁，用于在密集版履历中覆盖分页边界附近的布局表现。',
        '示例职责描述戊，用于验证多条等长内容不会产生重叠或裁切。',
      ]
    : [
        'Sample responsibility A verifies wrapping and spacing for a longer line in the experience section.',
        'Sample responsibility B verifies bullet alignment, line height, and rhythm between adjacent entries.',
        'Sample responsibility C is structural placeholder text and does not represent real experience or results.',
        'Sample responsibility D exercises layout behavior near a page boundary in the dense fixture.',
        'Sample responsibility E verifies that similarly sized entries are neither clipped nor overlapped.',
      ];
  return {
    company: zh ? `示例组织 ${i + 1}` : `Example Organization ${i + 1}`,
    role: zh ? '示例职位' : 'Example Role',
    location: zh ? '远程' : 'Remote',
    dates: `${2025 - i}.01 – ${2026 - i}.01`,
    bullets: dense ? bullets : bullets.slice(0, 2),
  };
}

/** Build one neutral project entry without experience or authorship claims. */
function project(i, zh) {
  return {
    name: zh ? `示例项目 ${i + 1}` : `Example Project ${i + 1}`,
    badge: '',
    tech: zh ? '工具甲 · 工具乙 · 工具丙 · 工具丁' : 'Tool A · Tool B · Tool C · Tool D',
    description: zh
      ? '示例项目描述，仅用于覆盖文本换行、项目间距和密集版页面布局。'
      : 'Sample project description used only to exercise wrapping, spacing, and dense-page layout.',
  };
}

/** Assemble one complete standard-template fixture. */
function fixture(id, lang, dense, withPhoto) {
  const payload = base(lang, withPhoto);
  const zh = lang === 'zh-CN';
  payload.experience = Array.from({ length: dense ? 5 : 1 }, (_, i) => role(i, zh, dense));
  payload.projects = Array.from({ length: dense ? 4 : 1 }, (_, i) => project(i, zh));
  return { id, dense, withPhoto, payload };
}

export const fixtures = [
  fixture('en-short-no-photo', 'en', false, false),
  fixture('en-long-photo', 'en', true, true),
  fixture('zh-short-no-photo', 'zh-CN', false, false),
  fixture('zh-long-photo', 'zh-CN', true, true),
];
