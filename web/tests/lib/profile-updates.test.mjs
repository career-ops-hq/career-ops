import test from "node:test";
import assert from "node:assert/strict";
import { buildProfileUpdatePreview, listWorkExperience, validateProfileUpdateRequest, verifyApprovedProfileUpdate } from "../../src/lib/profile-updates.mjs";

const CV = `# Jane Doe

## Technical Expertise

- Java

## Professional Experience

### Example Corp — Remote
**Software Engineer**
2020 – Present

- Built backend services.
- Improved reliability.

---

## Selected Projects

### Existing Project
Description

---

## Education

**Existing Degree**
School
2020

---

## Certifications

**Existing Cert — Existing Org**
2021
`;
const certification = { updateType: "certification", data: { name: "New Cert", organization: "Issuer", dateEarned: "2026-01-01", expirationDate: "", credentialId: "", credentialUrl: "", relatedSkills: ["Java"], notes: "" } };
const skill = (overrides = {}) => ({ updateType: "skill", data: { name: "Kubernetes", category: "Platforms", experienceSource: "Certification/training", professionalUse: false, whereUsed: "", years: "", notes: "", ...overrides } });

test("certification preview and approved apply are deterministic", () => {
  const preview = buildProfileUpdatePreview(CV, certification);
  assert.match(preview.preview.markdown, /New Cert — Issuer/); assert.doesNotMatch(CV, /New Cert/);
  const applied = verifyApprovedProfileUpdate(CV, { ...certification, approved: true, previewHash: preview.previewHash });
  assert.match(applied.proposedCv, /New Cert — Issuer/);
});
test("apply requires explicit approval and matching preview", () => {
  const preview = buildProfileUpdatePreview(CV, certification);
  assert.throws(() => verifyApprovedProfileUpdate(CV, { ...certification, previewHash: preview.previewHash }), /Explicit preview approval/);
  assert.throws(() => verifyApprovedProfileUpdate(CV + "changed", { ...certification, approved: true, previewHash: preview.previewHash }), /preview is stale/);
});
test("training-only skill never changes professional experience", () => {
  const result = buildProfileUpdatePreview(CV, skill());
  assert.equal(result.proposedCv.match(/Used Kubernetes professionally/g), null);
  assert.match(result.proposedCv, /Professional use: No/);
});
test("professional skill associates only with an explicitly selected experience", () => {
  const unselected = buildProfileUpdatePreview(CV, skill({ experienceSource: "Professional work", professionalUse: true }));
  assert.doesNotMatch(unselected.proposedCv, /Used Kubernetes professionally/);
  const selected = buildProfileUpdatePreview(CV, skill({ experienceSource: "Professional work", professionalUse: true, experienceIndex: 0, whereUsed: "Example Corp" }));
  assert.match(selected.proposedCv, /Used Kubernetes professionally in Example Corp/);
});
test("project creation preserves entered project facts", () => {
  const result = buildProfileUpdatePreview(CV, { updateType: "project", data: { name: "New Project", projectType: "Personal", organization: "", role: "Developer", startDate: "2025-01", endDate: "", present: true, description: "Built a tool.", technologies: ["Java"], responsibilities: ["Designed it."], achievements: [], metrics: "", url: "" } });
  assert.match(result.proposedCv, /### New Project/); assert.match(result.proposedCv, /\*\*Technologies:\*\* Java/);
});
test("existing work entries are selectable and duplicate bullets are detected", () => {
  assert.equal(listWorkExperience(CV)[0].label, "Example Corp — Remote — Software Engineer");
  const duplicate = buildProfileUpdatePreview(CV, { updateType: "work", data: { experienceIndex: 0, changeType: "responsibility", value: "Built backend services." } });
  assert.equal(duplicate.duplicate, true);
});
test("education update appends a deterministic record", () => {
  const result = buildProfileUpdatePreview(CV, { updateType: "education", data: { entryType: "degree", degree: "Master of Science", school: "Example University", graduationYear: "2026", coursework: ["Systems"], program: "" } });
  assert.match(result.proposedCv, /Master of Science/); assert.match(result.proposedCv, /Relevant coursework: Systems/);
});
test("duplicate education records require confirmation", () => {
  const request = { updateType: "education", data: { entryType: "degree", degree: "Existing Degree", school: "School", graduationYear: "2020", coursework: [], program: "" } };
  const preview = buildProfileUpdatePreview(CV, request);
  assert.equal(preview.duplicate, true);
  assert.throws(() => verifyApprovedProfileUpdate(CV, { ...request, approved: true, previewHash: preview.previewHash }), /Duplicate confirmation/);
  assert.doesNotThrow(() => verifyApprovedProfileUpdate(CV, { ...request, approved: true, previewHash: preview.previewHash, confirmDuplicate: true }));
});
test("duplicate certification and skill are reported", () => {
  assert.equal(buildProfileUpdatePreview(CV, { ...certification, data: { ...certification.data, name: "Existing Cert", organization: "Existing Org" } }).duplicate, true);
  assert.equal(buildProfileUpdatePreview(CV, skill({ name: "Java" })).duplicate, true);
});
test("invalid update types and arbitrary path fields fail closed", () => {
  assert.throws(() => validateProfileUpdateRequest({ updateType: "unknown", data: {} }), /Invalid profile update type/);
  assert.throws(() => validateProfileUpdateRequest({ ...certification, path: "../cv.md" }), /Unexpected request field "path"/);
  assert.throws(() => validateProfileUpdateRequest({ updateType: "skill", data: { ...skill().data, path: "../secrets" } }), /Unexpected skill field "path"/);
});
