import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import { resolveCodeRoot } from './code-root.mjs';
import { isMapping } from '../portals-config.mjs';

/** Synchronous shape-only mirror of the core's workplacePolicyFromConfig,
 * parity-tested so Discover cannot turn broken config into an absent policy.
 */
export function workplacePolicyConfig(config) {
  if (!isMapping(config)) throw new Error('portals.yml must contain a YAML mapping');
  if (config.location_filter === undefined) return undefined;
  if (!isMapping(config.location_filter)) throw new Error('location_filter must be an object');
  const policy = config.location_filter.workplace_policy;
  if (policy !== undefined && !isMapping(policy)) throw new Error('location_filter.workplace_policy must be an object');
  return policy;
}

/** Read current user policy and delegate to the same core gate as the scanner.
 * ENOENT keeps legacy/no-policy behavior; invalid files surface as an error.
 */
export async function loadWorkplacePolicy(root, codeRoot = resolveCodeRoot(process.cwd(), process.env)) {
  let config;
  try { config = yaml.load(fs.readFileSync(path.join(root, 'portals.yml'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return () => ({ eligible: true, reason: 'policy_absent' }); throw error; }
  const policy = workplacePolicyConfig(config);
  if (policy === undefined) return () => ({ eligible: true, reason: 'policy_absent' });
  const url = pathToFileURL(path.join(codeRoot, 'providers', '_country.mjs')).href;
  const { buildWorkplacePolicy } = await import(/* webpackIgnore: true */ url);
  return buildWorkplacePolicy(policy);
}
