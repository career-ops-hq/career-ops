import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import yaml from 'js-yaml';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(DIR);
const LLM_CONFIG_PATH = path.join(REPO, 'config', 'careerops-llm.yml');
const DEFAULT_HERMES_HOME = path.join(
  process.env.LOCALAPPDATA || '', 'hermes', 'profiles', 'careeropsjob',
);

export function loadCareerOpsLlmConfig() {
  const cfg = yaml.load(readFileSync(LLM_CONFIG_PATH, 'utf8')) || {};
  if (!cfg.provider || !cfg.model) throw new Error(`Invalid CareerOps LLM config: ${LLM_CONFIG_PATH}`);
  return cfg;
}

function loadAuth(profileName) {
  const hermesHome = process.env.HERMES_HOME || path.join(
    process.env.LOCALAPPDATA || '', 'hermes', 'profiles', profileName || 'careeropsjob',
  );
  const authPath = path.join(hermesHome, 'auth.json');
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  return { auth, authPath };
}

/** Call the centrally configured CareerOps model through its native API. */
export async function callCareerOpsLlm({ prompt, system = '', timeoutMs } = {}) {
  const cfg = loadCareerOpsLlmConfig();
  if (cfg.provider !== 'minimax-oauth' || cfg.api !== 'anthropic-messages') {
    throw new Error(`Unsupported CareerOps LLM route: ${cfg.provider}/${cfg.api}`);
  }
  const { auth, authPath } = loadAuth(cfg.profile);
  const provider = auth?.providers?.[cfg.provider];
  if (!provider?.access_token) throw new Error(`No access token for ${cfg.provider} in ${authPath}`);
  const endpoint = (provider.resource_url || `${provider.inference_base_url}/v1`).replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || cfg.request_timeout_ms || 180000);
  try {
    const response = await fetch(`${endpoint}/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.access_token}`,
        'x-api-key': provider.access_token,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: Number(cfg.max_tokens || 4096),
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${cfg.provider} HTTP ${response.status}: ${text.slice(0, 500)}`);
    const data = JSON.parse(text);
    return (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  } finally {
    clearTimeout(timer);
  }
}
