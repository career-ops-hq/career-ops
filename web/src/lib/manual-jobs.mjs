export const MANUAL_JOB_SOURCE = "manual-job";
export const MAX_JOB_DESCRIPTION_LENGTH = 60_000;
export const MANUAL_FETCH_FAILURE_MESSAGE = "Career-Ops could not read this posting automatically. Paste the job description below.";

const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const key = (value) => clean(value, 500).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function normalizeManualJobInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Manual job input must be an object.");
  const allowed = new Set(["source", "url", "company", "title", "location", "compensation", "description"]);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) throw new Error(`Unexpected manual job field "${unknown[0]}".`);
  const url = clean(value.url, 2_048);
  const description = clean(value.description, MAX_JOB_DESCRIPTION_LENGTH + 1);
  if (!url && !description) throw new Error("Provide a Job URL or Job Description.");
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error("Job URL must be a valid http or https URL."); }
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("Job URL must use http or https.");
  }
  if (description.length > MAX_JOB_DESCRIPTION_LENGTH) throw new Error(`Job Description must be ${MAX_JOB_DESCRIPTION_LENGTH.toLocaleString()} characters or fewer.`);
  const company = clean(value.company, 160);
  const title = clean(value.title, 200);
  if (!url && (!company || !title)) throw new Error("Company and Job Title are required when evaluating a pasted description without a URL.");
  return {
    source: MANUAL_JOB_SOURCE,
    url,
    company,
    title,
    location: clean(value.location, 200),
    compensation: clean(value.compensation, 300),
    description,
  };
}

export function parseManualJobInput(input) {
  if (typeof input !== "string" || !input.trim().startsWith("{")) return null;
  let value;
  try { value = JSON.parse(input); } catch { return null; }
  if (value?.source !== MANUAL_JOB_SOURCE) return null;
  return normalizeManualJobInput(value);
}

export function canonicalJobUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

export function findManualJobDuplicate(job, applications, reportForApplication = (_application) => "") {
  const url = canonicalJobUrl(job.url);
  if (url) {
    for (const app of applications) {
      const report = String(reportForApplication(app) || "");
      const reportUrl = report.match(/^\*\*URL:\*\*\s*(https?:\/\/\S+)/im)?.[1] || "";
      if (canonicalJobUrl(reportUrl) === url) return { type: "url", applicationId: app.n, company: app.company, title: app.role };
    }
  } else {
    const company = key(job.company); const title = key(job.title);
    const match = applications.find((app) => key(app.company) === company && key(app.role) === title);
    if (match) return { type: "company-title", applicationId: match.n, company: match.company, title: match.role };
  }
  return null;
}

export function manualJobInputForWorker(job) {
  return JSON.stringify(normalizeManualJobInput(job));
}
