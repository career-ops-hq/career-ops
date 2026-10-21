// An 80 x 80 geometric silhouette, drawn specifically for these fixtures.
// Unlike a transparent pixel, its contrasting shapes make crop regressions visible.
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAIAAAABc2X6AAAA40lEQVR42u3ZUQ3DQAyDYXMqoBEY5gKoBmJDsF2vyS1ufikEPuXFcbQfr1YjwIABAwYMGDBgwIABAy4N3h7Pm4M/wu9zK/BP7TKzilCXsVVNm21WQW2qGXANbZ5ZZbVJZsCAAQNO02aY2TBgwIABt8vSnIc9wO0aj46dVsfWsmkv3fHzwDMNMGDAgAEDJnjUCdJrAib3MJ3Wf98O4WwVp4az5aKNMstIG2KWETWELUftFTNgE+20Wb7aObOstRNmwG7as2bAhtpTZsCe2nEzYMAu2kEzYMCAAQP2BhtpR8ztNvwG6/2xD8WY+jQAAAAASUVORK5CYII=';

/** Build neutral bilingual profile data for layout-only regression tests. */
function base(lang, dense, withPhoto) {
  const zh = lang === 'zh-CN';
  return {
    lang,
    page_format: 'a4',
    candidate: {
      name: zh ? '示例候选人' : 'Example Candidate',
      phone: '+1 555 010 2048',
      email: 'candidate@example.com',
      linkedin: { url: 'https://example.com/in/candidate', display: 'example.com/in/candidate' },
      portfolio: dense
        ? { url: 'https://candidate.example.com/work/platform-reliability', display: 'candidate.example.com/work/platform-reliability' }
        : { url: 'https://candidate.example.com', display: 'candidate.example.com' },
      location: zh ? '中国｜杭州' : 'Toronto, Canada',
      photo: withPhoto ? PHOTO : '',
      photo_style: 'circle',
    },
    sections: zh ? {
      summary: '个人简介', competencies: '核心能力', experience: '工作经历', projects: '精选项目',
      education: '教育经历', certifications: '专业认证', skills: '技术能力',
    } : {
      summary: 'Summary', competencies: 'Core Competencies', experience: 'Experience', projects: 'Selected Projects',
      education: 'Education', certifications: 'Certifications', skills: 'Skills',
    },
    summary: zh
      ? '视觉布局测试专用的示例简介，不代表任何真实候选人的经历或能力。'
      : 'Sample summary for visual layout testing; it does not describe a real candidate.',
    competencies: dense
      ? (zh
          ? ['跨团队平台架构与可靠性工程', '中英文产品需求分析与交付协调', '持续集成及自动化质量验证', '分布式服务可观测性与故障分析']
          : ['Cross-team Platform Architecture', 'Product Discovery and Delivery Planning', 'Continuous Integration and Quality Engineering', 'Distributed Systems Observability'])
      : (zh ? ['平台工程', '产品交付', '质量验证', '服务监控'] : ['Platform Engineering', 'Product Delivery', 'Quality Assurance', 'Service Monitoring']),
    experience: [],
    projects: [],
    education: [{ title: zh ? '示例学位' : 'Example Degree', org: zh ? '示例院校' : 'Example Institution', year: '2025' }],
    certifications: [{ title: zh ? '示例认证' : 'Example Certificate', org: zh ? '示例机构' : 'Example Organization', year: '2025' }],
    skills: dense
      ? [{
          category: zh ? '平台工程与质量验证' : 'Platform Engineering and Quality',
          items: zh
            ? ['TypeScript 服务开发', 'PostgreSQL 数据建模', '持续集成与自动化测试', 'OpenTelemetry 服务监控']
            : ['TypeScript Service Development', 'PostgreSQL Data Modeling', 'Continuous Integration and Testing', 'OpenTelemetry Instrumentation'],
        }]
      : [{ category: zh ? '工程工具' : 'Engineering Tools', items: ['TypeScript', 'PostgreSQL', 'Playwright'] }],
  };
}

/** Build one neutral experience entry, expanding bullets for dense fixtures. */
function role(i, zh, dense) {
  const shortBullets = zh
    ? [
        '示例职责描述甲，用于验证较长中文文本在工作经历区域中的自动换行和间距。',
        '示例职责描述乙，用于验证列表符号、行高以及连续条目之间的视觉关系。',
      ]
    : [
        'Sample responsibility A verifies wrapping and spacing for a longer line in the experience section.',
        'Sample responsibility B verifies bullet alignment, line height, and rhythm between adjacent entries.',
      ];
  // Long entries must wrap even in the compact templates, so that the dense
  // cases exercise pagination without an unrealistic number of prior jobs.
  const longBullets = zh
    ? [
        '示例职责描述甲，用于验证较长中文文本在工作经历区域中的自动换行和间距，同时检查跨团队需求分析、实施规划与文档交付等常见履历内容，确保跨页内容保持可读性、信息完整性与合理的段落结构。',
        '示例职责描述乙，用于验证列表符号、行高以及连续条目之间的视觉关系，检查平台服务、持续集成流程及分布式系统监控相关术语的排版，确保跨页内容保持可读性、信息完整性与合理的段落结构。',
        '示例职责描述丙，仅作为结构占位文本，不代表任何真实经验、技术或成果，同时覆盖对软件架构、服务维护与工程质量验证的完整描述，确保跨页内容保持可读性、信息完整性与合理的段落结构。',
        '示例职责描述丁，用于在密集版履历中覆盖分页边界附近的布局表现，并检查跨行内容是否保留完整文本、自然的段落间距以及清晰的阅读顺序，确保跨页内容保持可读性、信息完整性与合理的段落结构。',
        '示例职责描述戊，用于验证产品交付、自动化测试与维护计划的完整段落，保证较长的内容在不同模板中依然清晰可读并且能够完整提取，确保跨页内容保持可读性、信息完整性与合理的段落结构。',
      ]
    : [
        'Sample responsibility A verifies wrapping and spacing for a longer experience entry describing cross-team discovery, implementation planning, and documentation delivery.',
        'Sample responsibility B verifies bullet alignment, line height, and rhythm for descriptions of platform services, continuous integration, and distributed system monitoring.',
        'Sample responsibility C is structural placeholder text without real achievements, covering the length of a complete software architecture, service maintenance, and quality review description.',
        'Sample responsibility D exercises layout near a page boundary, checking that wrapped descriptions retain their complete text, readable paragraph spacing, and natural reading order.',
        'Sample responsibility E exercises a complete description of product delivery, automated verification, and maintenance planning so that longer entries remain readable and extractable.',
        'Sample responsibility F describes cross-team collaboration and system migration solely as sample content for checking engineering terminology, punctuation, and reading order.',
      ];
  return {
    company: dense
      ? (zh ? `示例应用系统与基础设施研究中心 ${i + 1}` : `Example Applied Systems and Infrastructure Research Group ${i + 1}`)
      : (zh ? '示例科技' : 'Example Systems'),
    role: dense
      ? (zh ? '平台架构与可靠性工程师' : 'Platform and Reliability Engineer')
      : (zh ? '示例工程师' : 'Example Engineer'),
    location: zh ? '远程' : 'Remote',
    dates: dense
      ? (zh ? `${2023 - i * 2} 年 9 月 – ${2025 - i * 2} 年 9 月` : `September ${2023 - i * 2} – September ${2025 - i * 2}`)
      : '2024 – 2025',
    bullets: dense ? longBullets : shortBullets,
  };
}

/** Build one neutral project entry without experience or authorship claims. */
function project(i, zh, dense) {
  return {
    name: dense
      ? (zh ? `示例跨区域服务可靠性与持续交付平台 ${i + 1}` : `Example Cross-region Service Reliability and Delivery Platform ${i + 1}`)
      : (zh ? '示例项目' : 'Example Project'),
    badge: '',
    tech: zh ? '工具甲 · 工具乙 · 工具丙 · 工具丁' : 'Tool A · Tool B · Tool C · Tool D',
    description: zh
      ? '示例项目描述，仅用于覆盖文本换行、项目间距和密集版页面布局。'
      : 'Sample project description used only to exercise wrapping, spacing, and dense-page layout.',
  };
}

/** Assemble a fictional payload shared unchanged by every discoverable template. */
function fixture(id, lang, dense, withPhoto) {
  const payload = base(lang, dense, withPhoto);
  const zh = lang === 'zh-CN';
  payload.experience = Array.from({ length: dense ? 4 : 1 }, (_, i) => role(i, zh, dense));
  payload.projects = Array.from({ length: dense ? 2 : 1 }, (_, i) => project(i, zh, dense));
  return { id, dense, withPhoto, payload };
}

// Keep language, content density, and photo independent: otherwise a regression
// affecting only (for example) a short Chinese CV with a photo has no witness.
export const fixtures = ['en', 'zh-CN'].flatMap((lang) =>
  [false, true].flatMap((dense) =>
    [false, true].map((withPhoto) => fixture(
      `${lang === 'en' ? 'en' : 'zh'}-${dense ? 'long' : 'short'}-${withPhoto ? 'photo' : 'no-photo'}`,
      lang, dense, withPhoto,
    ))));
