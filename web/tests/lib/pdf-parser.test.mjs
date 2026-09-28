import test from "node:test";
import assert from "node:assert/strict";
import { parseCvTextToMarkdown } from "../../src/lib/cv/pdf-parser.ts";

test("parseCvTextToMarkdown handles empty and whitespace-only text", () => {
  const empty = parseCvTextToMarkdown("");
  assert.equal(empty.markdown, "");
  assert.deepEqual(empty.candidate, {});
  assert.deepEqual(empty.skills, []);

  const ws = parseCvTextToMarkdown("   \n\n  \t ");
  assert.equal(ws.markdown, "");
});

test("parseCvTextToMarkdown retains unknown sections and unheaded content", () => {
  const input = `
Jane Doe
jane.doe@example.com | (555) 123-4567 | San Francisco, CA
linkedin.com/in/janedoe | github.com/janedoe | janedoe.dev

Senior ML Engineer with extensive experience in production LLM architectures and distributed systems.

WORK EXPERIENCE
Staff AI Engineer at Acme AI (2022 - Present)
- Designed and built retrieval-augmented generation pipelines using LangChain and PyTorch.
- Reduced inference latency by 45%.

PROJECTS
OpenSource LLM Bench
- Developed an open-source evaluation suite with 1,200+ stars.

AWARDS & HONORS
- Best Paper Award at NeurIPS Workshop 2023.

EDUCATION
Master of Science in Computer Science, Stanford University
Bachelor of Science in Mathematics, UC Berkeley
`;

  const parsed = parseCvTextToMarkdown(input);

  assert.equal(parsed.candidate.fullName, "Jane Doe");
  assert.equal(parsed.candidate.email, "jane.doe@example.com");
  assert.equal(parsed.candidate.phone, "(555) 123-4567");
  assert.equal(parsed.candidate.location, "San Francisco, CA");
  assert.equal(parsed.candidate.linkedin, "linkedin.com/in/janedoe");
  assert.equal(parsed.candidate.github, "github.com/janedoe");
  assert.equal(parsed.candidate.portfolio, "janedoe.dev");

  // Check that markdown contains header and contact info
  assert.ok(parsed.markdown.includes("# CV -- Jane Doe"));
  assert.ok(parsed.markdown.includes("**Email:** jane.doe@example.com"));
  assert.ok(parsed.markdown.includes("**Location:** San Francisco, CA"));

  // Check unheaded summary retention
  assert.ok(parsed.markdown.includes("Senior ML Engineer with extensive experience"));

  // Check work experience section
  assert.ok(parsed.markdown.includes("## Work Experience"));
  assert.ok(parsed.markdown.includes("Staff AI Engineer at Acme AI"));
  assert.ok(parsed.markdown.includes("Reduced inference latency by 45%"));

  // Check unknown sections retention (Projects, Awards & Honors)
  assert.ok(parsed.markdown.includes("## Projects"));
  assert.ok(parsed.markdown.includes("OpenSource LLM Bench"));
  assert.ok(parsed.markdown.includes("## Awards & Honors"));
  assert.ok(parsed.markdown.includes("Best Paper Award at NeurIPS Workshop 2023"));

  // Check education section retention
  assert.ok(parsed.markdown.includes("## Education"));
  assert.ok(parsed.markdown.includes("Master of Science in Computer Science, Stanford University"));
  assert.ok(parsed.markdown.includes("Bachelor of Science in Mathematics, UC Berkeley"));
});

test("parseCvTextToMarkdown preserves existing markdown headings and content", () => {
  const input = `# Jane Doe
**Email:** jane@example.com

## Professional Summary
Experienced engineer.

## Publications
1. Doe, J. (2024). Scalable Transformers. Journal of ML.

## Certifications
- AWS Certified Machine Learning - Specialty
`;

  const parsed = parseCvTextToMarkdown(input);
  assert.ok(parsed.markdown.includes("## Professional Summary"));
  assert.ok(parsed.markdown.includes("Experienced engineer."));
  assert.ok(parsed.markdown.includes("## Publications"));
  assert.ok(parsed.markdown.includes("Scalable Transformers"));
  assert.ok(parsed.markdown.includes("## Certifications"));
  assert.ok(parsed.markdown.includes("AWS Certified Machine Learning - Specialty"));
});
