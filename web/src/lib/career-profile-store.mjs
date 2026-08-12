import path from "node:path";
import yaml from "js-yaml";

import { resolvePrivatePath, secureAtomicWrite, secureReadText } from "./secure-user-storage.mjs";

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, updates) {
  const result = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(updates || {})) {
    if (BLOCKED_KEYS.has(key)) continue;
    result[key] = isPlainObject(value) ? deepMerge(result[key], value) : value;
  }
  return result;
}

function cleanText(value, max = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanList(value, maxItems = 50) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 200)).filter(Boolean))].slice(0, maxItems);
}

function normalizeProfile(profile) {
  const candidate = isPlainObject(profile.candidate) ? profile.candidate : {};
  const narrative = isPlainObject(profile.narrative) ? profile.narrative : {};
  const targets = isPlainObject(profile.target_roles) ? profile.target_roles : {};
  const compensation = isPlainObject(profile.compensation) ? profile.compensation : {};
  return {
    fullName: cleanText(candidate.full_name, 200),
    email: cleanText(candidate.email, 320),
    phone: cleanText(candidate.phone, 100),
    location: cleanText(candidate.location, 300),
    linkedin: cleanText(candidate.linkedin, 500),
    portfolio: cleanText(candidate.portfolio_url, 500),
    portfolioUrl: cleanText(candidate.portfolio_url, 500),
    headline: cleanText(narrative.headline, 500),
    summary: cleanText(narrative.exit_story, 4_000),
    targetRoles: cleanList(targets.primary),
    skills: cleanList(narrative.superpowers),
    workModes: cleanList(compensation.location_flexibility),
  };
}

function profileUpdates(input) {
  if (!isPlainObject(input)) throw new Error("Masterprofilen måste vara ett objekt.");
  return {
    candidate: {
      full_name: cleanText(input.fullName, 200),
      email: cleanText(input.email, 320),
      phone: cleanText(input.phone, 100),
      location: cleanText(input.location, 300),
      linkedin: cleanText(input.linkedin, 500),
      portfolio_url: cleanText(input.portfolioUrl || input.portfolio, 500),
    },
    target_roles: { primary: cleanList(input.targetRoles) },
    compensation: { location_flexibility: cleanList(input.workModes) },
    narrative: {
      headline: cleanText(input.headline, 500),
      exit_story: cleanText(input.summary, 4_000),
      superpowers: cleanList(input.skills),
    },
  };
}

function fileFor(root, options = {}) {
  return resolvePrivatePath(root, options.profileFile || path.join("config", "profile.yml"));
}

export async function readCareerMasterProfile(root, options = {}) {
  const source = await secureReadText(root, fileFor(root, options), "");
  if (!source.trim()) return normalizeProfile({});
  const parsed = yaml.load(source);
  return normalizeProfile(isPlainObject(parsed) ? parsed : {});
}

export async function saveCareerMasterProfile(root, input, options = {}) {
  const target = fileFor(root, options);
  const source = await secureReadText(root, target, "");
  const parsed = source.trim() ? yaml.load(source) : {};
  const merged = deepMerge(isPlainObject(parsed) ? parsed : {}, profileUpdates(input));
  const serialized = yaml.dump(merged, { lineWidth: 120, noRefs: true, sortKeys: false });
  await secureAtomicWrite(root, target, serialized);
  return normalizeProfile(merged);
}
