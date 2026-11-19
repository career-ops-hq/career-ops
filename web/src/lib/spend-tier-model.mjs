/**
 * spend-tier-model.mjs — honour `spend_tier` (config/profile.yml) for the AI
 * runs the web starts.
 *
 * `spend_tier` picks the model that evaluates offers (modes/_shared.md →
 * "Spend Tier (Model Routing)"), and batch/batch-runner.sh resolves it for every
 * headless batch worker. The web spawned its workers with no model at all, so
 * every dashboard run (Score, CV, Explore, assistant, CV ingest, apply) used the
 * CLI's own default — often the most expensive model — whatever tier the user
 * chose.
 *
 * Applied in spawnHeadlessCli(), the single spawn path for those routes, so one
 * resolution covers them all. Only Claude Code has a fixed tier table; for the
 * other CLIs the table names no concrete model, so they are left untouched.
 *
 * The model is carried by ANTHROPIC_MODEL, an environment variable the `claude`
 * CLI reads, so no argv (and none of the fencing claude-invocation.mjs asserts
 * on) changes. A user who already exports ANTHROPIC_MODEL keeps it: an explicit
 * choice wins, the same way `--model` wins over the tier in batch-runner.sh.
 *
 * Absent key → `standard`; any other value → `standard` as well (validate-profile
 * reports the bad value). That is the documented resolution in _shared.md.
 */
import fs from "node:fs";
import * as yaml from "js-yaml";
import { getProfilePath } from "./core/profile-path.mjs";

/** Tier → model. Keep in sync with modes/_shared.md and batch/batch-runner.sh (spend_tier_to_model). */
export const CLAUDE_TIER_MODELS = Object.freeze({
  economy: "claude-haiku-5-5",
  standard: "claude-sonnet-5-5",
  premium: "claude-opus-5-5",
});

/**
 * @param {string | null} profileText Raw config/profile.yml, or null when absent/unreadable.
 * @returns {"economy" | "standard" | "premium"}
 */
export function spendTierFrom(profileText) {
  if (!profileText) return "standard";
  let parsed;
  try {
    parsed = yaml.load(profileText);
  } catch {
    return "standard";
  }
  const raw = parsed && typeof parsed === "object" ? /** @type {Record<string, unknown>} */ (parsed).spend_tier : undefined;
  const tier = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return tier === "economy" || tier === "premium" ? tier : "standard";
}

/**
 * Spawn options with the tier's model applied for `cliId`. Never throws: an
 * unreadable profile resolves to `standard`, like the CLI modes.
 *
 * Every web caller spawns with `cwd: careerOpsRoot()`, so the profile is read
 * from there (honouring CAREER_OPS_PROFILE through getProfilePath()).
 *
 * @template {{ cwd?: string | URL, env?: NodeJS.ProcessEnv }} T
 * @param {string} cliId
 * @param {T} options
 * @returns {T}
 */
export function withSpendTierModel(cliId, options) {
  if (cliId !== "claude") return options;
  const env = options?.env ?? process.env;
  if (env.ANTHROPIC_MODEL?.trim()) return options;
  const root = typeof options?.cwd === "string" ? options.cwd : null;
  if (!root) return options;
  let text = null;
  try {
    text = fs.readFileSync(getProfilePath(root, { env }), "utf8");
  } catch {
    text = null;
  }
  return { ...options, env: { ...env, ANTHROPIC_MODEL: CLAUDE_TIER_MODELS[spendTierFrom(text)] } };
}
