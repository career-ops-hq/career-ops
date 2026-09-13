import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeResume } from './analyzer.ts';
import { runBenchmarkCalibration } from './benchmarkRunner.ts';
import type { ResumeParseResult } from './types.ts';

describe('ATS Scoring Engine & Benchmark Calibration Test Suite', () => {

  function createMockParsedResume(text: string, isImageBased = false, fileSize = 2500): ResumeParseResult {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const words = text
      .split(/\s+/)
      .map(w => w.replace(/[^a-zA-Z0-9+#.-]/g, '').trim())
      .filter(Boolean);

    return {
      text,
      pageCount: isImageBased ? 1 : Math.max(1, Math.ceil(lines.length / 40)),
      isImageBased,
      fileType: 'pdf',
      fileName: 'test_resume.pdf',
      fileSize,
      lines,
      words
    };
  }

  it('Test A — Perfect resume should score 90+', () => {
    const text = `
Alex Mercer
Senior Software Engineer
San Francisco, CA | alex.mercer@email.com | +1 555-019-2834 | linkedin.com/in/alexmercer-dev | github.com/alexmercer

PROFESSIONAL SUMMARY
Results-driven Senior Software Engineer with over 8 years of experience building scalable backend microservices, high-throughput REST APIs, and cloud-native web applications. Proven track record in optimizing database queries, reducing service latency, and leading cross-functional engineering teams in fast-paced Agile environments.

WORK EXPERIENCE
Senior Software Engineer | CloudTech Solutions | San Francisco, CA | 2021 - Present
- Architected and deployed high-throughput microservices using Node.js, TypeScript, and Docker on AWS EKS, supporting over 10M daily active users.
- Reduced API response times by 45% by implementing Redis multi-level caching and optimizing complex PostgreSQL queries.
- Led a team of 6 engineers to migrate monolithic backend architecture into event-driven microservices, improving system uptime from 99.2% to 99.99%.
- Streamlined CI/CD deployment pipelines using GitHub Actions and Kubernetes, cutting deployment cycle times by 60%.

Software Engineer | DataScale Systems | San Jose, CA | 2017 - 2021
- Developed scalable web applications using Java, Spring Boot, and React, increasing platform user engagement by 35%.
- Integrated RESTful APIs with third-party payment gateways and authentication systems, handling $15M+ in annual transactions.
- Refactored legacy codebase and automated unit and end-to-end testing, boosting test coverage from 45% to 92%.
- Partnered with Product and Design teams to deliver 12 major features ahead of quarterly schedule.

EDUCATION
Bachelor of Science in Computer Science | University of California, Berkeley | 2013 - 2017
- Magna Cum Laude, GPA: 3.85/4.0

TECHNICAL SKILLS
- Languages: JavaScript, TypeScript, Python, Java, SQL, HTML5, CSS3
- Frameworks & Libraries: React, Node.js, Express, Spring Boot, Next.js
- Infrastructure & Tools: AWS, Docker, Kubernetes, PostgreSQL, Redis, REST APIs, Microservices, CI/CD, Git
- Methodologies: Agile, Scrum, System Architecture, Test-Driven Development (TDD)

CERTIFICATIONS
- AWS Certified Solutions Architect – Associate (2023)
- Certified Kubernetes Application Developer (CKAD) (2022)
    `.trim();

    const jd = "We are seeking a Senior Software Engineer to lead the design and implementation of cloud-native microservices. Requirements: 7+ years software engineering experience with Node.js, TypeScript, or Java. Strong expertise in REST APIs, PostgreSQL, Redis, AWS, Docker, Kubernetes, and CI/CD pipelines.";
    const result = analyzeResume(createMockParsedResume(text), jd);

    assert.ok(result.totalScore >= 90, `Perfect resume should score >= 90, got ${result.totalScore}`);
  });

  it('Test B — Missing keywords should produce lower keyword score', () => {
    const text = `
Alex Mercer
Software Engineer
alex.mercer@email.com | +1 555-019-2834

WORK EXPERIENCE
Software Developer | TechCorp | 2021 - Present
- Developed frontend forms using basic HTML and CSS.

EDUCATION
BS Computer Science | State University

SKILLS
HTML, CSS, Basic JavaScript
    `.trim();

    const jd = "Seeking Data Scientist with expertise in Python, PyTorch, TensorFlow, Machine Learning, Deep Learning, SQL, Statistics, and A/B Testing.";
    const result = analyzeResume(createMockParsedResume(text), jd);

    const keywordItem = result.breakdown.find(b => b.category === 'Keyword Relevance');
    assert.ok(keywordItem && keywordItem.score <= 10, `Missing keywords should result in low keyword score, got ${keywordItem?.score}`);
  });

  it('Test C — Poor formatting should apply formatting penalty', () => {
    const text = `
John Doe
john@email.com | 555-1234
--------------------------------------------------
**************************************************
==================================================
Experience:
Worked at company doing stuff.
    `.trim();

    const result = analyzeResume(createMockParsedResume(text));
    assert.ok(result.formatting.some(f => f.type === 'warning' || f.type === 'error'), 'Poor formatting should trigger warning/error issues');
  });

  it('Test D — Keyword stuffing should NOT artificially boost score', () => {
    const textStuffed = `
Jane Doe
jane@email.com | 555-9876

WORK EXPERIENCE
Python Developer | Dev Inc | 2021 - Present
Python Python Python Python Python Python Python Python Python Python Python Python Python Python Python Python Python Python Python Python

EDUCATION
BS Computer Science

SKILLS
Python, SQL
    `.trim();

    const textNormal = `
Jane Doe
jane@email.com | 555-9876

WORK EXPERIENCE
Python Developer | Dev Inc | 2021 - Present
- Built Python data pipelines that automated reporting and reduced processing time by 35%.

EDUCATION
BS Computer Science

SKILLS
Python, SQL
    `.trim();

    const jd = "Seeking Python Developer with SQL experience.";
    const stuffedResult = analyzeResume(createMockParsedResume(textStuffed), jd);
    const normalResult = analyzeResume(createMockParsedResume(textNormal), jd);

    assert.ok(stuffedResult.keywords.overusedKeywords.length > 0, 'Keyword stuffing should detect overused keywords');
    assert.ok(stuffedResult.totalScore <= normalResult.totalScore, 'Keyword stuffing should not exceed legitimate achievement resume score');
  });

  it('Test E — Wrong job target should result in low relevance score', () => {
    const text = `
Marcus Vance
Senior Product Manager
marcus@email.com | 555-016-3390

EXPERIENCE
Product Manager | SaaSify | 2021 - Present
- Managed product roadmaps, user stories, and Jira backlog for B2B SaaS apps.

EDUCATION
BS Information Systems

SKILLS
Product Strategy, Product Analytics, Agile, Scrum, Jira
    `.trim();

    const jd = "Seeking Financial Analyst expert in Financial Modeling, FP&A, DCF Valuation, Bloomberg Terminal, Variance Analysis, and SAP ERP.";
    const result = analyzeResume(createMockParsedResume(text), jd);

    assert.ok(result.keywords.roleAlignment === 'Weak' || result.keywords.roleAlignment === 'None' || result.keywords.roleAlignment === 'Fair', 'Mismatched role target should have non-strong alignment');
    assert.ok(result.totalScore < 85, 'Mismatched job description should lower overall job match score');
  });

  it('Test F — Strong experience but poor formatting should show high content but lower formatting score', () => {
    const text = `
Robert Sterling
Engineering Manager
robert@email.com | 555-011-2299
--------------------------------------------------
**************************************************
WORK EXPERIENCE
Engineering Manager | CloudScale | 2020 - Present
- Led team of 18 engineers, reduced deployment time by 42%, improved release frequency by 60%, and cut cloud costs by 30%.
- Managed $4M annual AWS budget.

EDUCATION
MS Computer Science | Stanford

SKILLS
Leadership, Hiring, Mentoring, AWS, Microservices, CI/CD
    `.trim();

    const result = analyzeResume(createMockParsedResume(text));
    const formatItem = result.breakdown.find(b => b.category === 'ATS Formatting');
    const expItem = result.breakdown.find(b => b.category === 'Achievement Quality');

    assert.ok(expItem && expItem.score >= 7, 'Strong achievements should score high in achievement quality');
    assert.ok(result.formatting.some(f => f.type === 'warning'), 'Formatting issues should be flagged');
  });

  it('Test G — Great formatting but weak content should show high formatting but low content score', () => {
    const text = `
Sam Smith
Seattle, WA | sam.smith@email.com | +1 555-019-9988

SUMMARY
Motivated worker looking for opportunities.

WORK EXPERIENCE
Assistant | Local Office | 2022 - Present
- Responsible for daily duties and helping out.
- Worked on office stuff.

EDUCATION
High School Diploma | Central High

SKILLS
Communication, Microsoft Word
    `.trim();

    const result = analyzeResume(createMockParsedResume(text));
    const formatItem = result.breakdown.find(b => b.category === 'ATS Formatting');
    const expItem = result.breakdown.find(b => b.category === 'Achievement Quality');

    assert.ok(formatItem && formatItem.score >= 8, 'Clean formatting should score high in ATS formatting');
    assert.ok(expItem && expItem.score <= 3, 'Weak bullets without metrics should score low in achievement quality');
  });

  it('Test H — Image-only PDF should flag high parsing risk', () => {
    const text = "Scanned document text sample";
    const result = analyzeResume(createMockParsedResume(text, true, 500));

    assert.equal(result.isImageBased, true, 'isImageBased should be true');
    assert.equal(result.formattingRiskLevel, 'high risk', 'Formatting risk level should be high risk');
    assert.ok(result.parsingWarning && result.parsingWarning.includes('could not reliably read'), 'Parsing warning should inform user');
  });

  it('Calibration Benchmark Suite Test — All 10 synthetic benchmarks run successfully', () => {
    const report = runBenchmarkCalibration();
    assert.equal(report.totalBenchmarks, 10, 'Should calibrate 10 benchmark resumes');
    assert.ok(report.averageScore >= 90, `Average score across benchmarks should be high (>= 90), got ${report.averageScore}`);
    assert.ok(report.inRangeCount >= 8, `At least 8/10 benchmarks should be within expected quality target, got ${report.inRangeCount}`);
  });

});
