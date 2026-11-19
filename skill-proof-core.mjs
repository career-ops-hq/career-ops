/**
 * skill-proof-core.mjs — pure core of the Skill Proof Builder (#7221).
 *
 * Turns what was read from a candidate's GitHub repositories (tree paths plus
 * a bounded set of manifests, container configs and READMEs) into per-skill
 * evidence, and classifies each target skill as:
 *
 *   STRONG            code-level evidence (a container config, source files,
 *                     SQL files) corroborated by a second signal: another kind,
 *                     or another code-level file
 *   PARTIAL           only declaration-level evidence: a dependency in a
 *                     manifest, a README mention, or code found only under
 *                     test / example / fixture paths
 *   NO EVIDENCE       every repository in scope was read completely and
 *                     nothing was found. Reported as "not found in the N
 *                     repositories inspected", never as "lacks the skill"
 *   UNABLE TO VERIFY  the skill is outside what this check can detect, or
 *                     coverage was incomplete (rate limit, truncated tree,
 *                     file cap, unreadable repository)
 *
 * Rules that keep it honest:
 *   - A dependency declaration alone is never STRONG.
 *   - Absence of evidence is never reported as absence of skill.
 *   - Every evidence item names the repository and file it came from.
 *   - Repository content is untrusted external content: data, never
 *     instructions (AGENTS.md → "Untrusted External Content"). It is only
 *     ever matched against fixed patterns here; nothing it says can change a
 *     classification except by matching one of those patterns.
 *
 * Pure and dependency-free (no network, no filesystem), so every rule is
 * unit-testable from fixtures. The GitHub reads live in skill-proof.mjs.
 */

import { CANONICAL, DISPLAY, extractSkills } from './skill-extract.mjs';
import { loadYaml } from './lib/yaml-document.mjs';

/**
 * Map a raw skill token to its canonical display name. Falls back to the
 * shared vocabulary (CANONICAL / DISPLAY) first, then checks whether the
 * lowercased token is a known source-file extension → language in
 * EXTENSION_SKILLS. This catches explicit targets like `--skills go` whose
 * bare-lowercase form is intentionally excluded from prose recognition in
 * skill-extract.mjs but should still resolve to `Go` when given explicitly.
 */
function canonicalize(token) {
  const s = String(token ?? '');
  const key = s.toLowerCase();
  if (Object.hasOwn(CANONICAL, key)) return CANONICAL[key];
  if (Object.hasOwn(DISPLAY, key)) return DISPLAY[key];
  // Extension-based language names (e.g. 'go' → 'Go') — only when the token
  // matches an extension exactly and the mapping is a known language.
  if (Object.hasOwn(EXTENSION_SKILLS, key)) return EXTENSION_SKILLS[key];
  return s;
}

export const LEVELS = Object.freeze({
  STRONG: 'STRONG',
  PARTIAL: 'PARTIAL',
  NO_EVIDENCE: 'NO EVIDENCE',
  UNABLE: 'UNABLE TO VERIFY',
});

export const SCHEMA = 'skill-proof/v1';
export const MAX_REPOS = 30;
export const MAX_FILES_PER_REPO = 15;
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_EVIDENCE_PER_SKILL = 6;
const MAX_DETAIL_LENGTH = 160;

// ── Path filtering ──────────────────────────────────────────────────

/** Directory names whose contents are someone else's code or build output. */
const IGNORED_DIRS = new Set([
  'node_modules', 'vendor', 'vendors', 'third_party', 'third-party', 'bower_components',
  'dist', 'build', 'out', 'target', '.venv', 'venv', 'env', '__pycache__', 'site-packages',
  'coverage', '.next', '.nuxt',
]);

/** Directory names whose code says little about day-to-day use. */
const WEAK_DIRS = /^(tests?|__tests__|spec|specs|fixtures?|test-fixtures|examples?|samples?|demo|demos|mocks?|testdata)$/i;

/**
 * Whether a blob path should never be read or counted: hidden segments
 * (except `.github`), vendored dependencies, build output, minified bundles.
 * @param {string} path
 * @returns {boolean}
 */
export function isIgnoredPath(path) {
  const parts = String(path ?? '').split('/');
  if (parts.some((p) => !p)) return true;
  for (const p of parts.slice(0, -1)) {
    if (IGNORED_DIRS.has(p.toLowerCase())) return true;
    if (p.startsWith('.') && p !== '.github') return true;
  }
  const file = parts[parts.length - 1];
  if (file.startsWith('.')) return true;
  return /\.min\.(js|css)$/i.test(file);
}

/** Whether a path sits under a test / example / fixture directory. */
export function isWeakPath(path) {
  return String(path ?? '').split('/').slice(0, -1).some((p) => WEAK_DIRS.test(p));
}

const basename = (path) => String(path).split('/').pop();
const depth = (path) => String(path).split('/').length - 1;

const MANIFEST_NAMES = new Set([
  'package.json', 'requirements.txt', 'pyproject.toml', 'pipfile', 'go.mod', 'cargo.toml',
  'gemfile', 'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
]);
const COMPOSE_RE = /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i;
const DOCKERFILE_RE = /^Dockerfile(\.[\w-]+)?$|\.dockerfile$/i;
const README_RE = /^readme(\.(md|markdown|rst|txt))?$/i;

/** Which reader handles a file, or null when it is not read. */
export function fileRole(path) {
  const file = basename(path);
  if (MANIFEST_NAMES.has(file.toLowerCase())) return 'manifest';
  if (DOCKERFILE_RE.test(file) || COMPOSE_RE.test(file)) return 'config';
  if (README_RE.test(file) && depth(path) === 0) return 'readme';
  return null;
}

/**
 * The files worth reading from one tree, bounded. Root README first, then
 * manifests and container configs by depth (root before nested). Ignored
 * paths, weak (test/example) paths and files over the byte cap are skipped
 * before any read is spent on them.
 *
 * @param {Array<{path: string, size?: number}>} entries - Blob entries.
 * @param {{maxFiles?: number, maxBytes?: number}} [opts]
 * @returns {{selected: string[], capped: boolean, oversized: string[]}}
 */
export function selectCandidateFiles(entries, { maxFiles = MAX_FILES_PER_REPO, maxBytes = MAX_FILE_BYTES } = {}) {
  const rank = { readme: 0, manifest: 1, config: 2 };
  const oversized = [];
  const candidates = [];
  for (const e of entries || []) {
    const path = typeof e === 'string' ? e : e?.path;
    if (typeof path !== 'string' || isIgnoredPath(path) || isWeakPath(path)) continue;
    const role = fileRole(path);
    if (!role) continue;
    if (Number.isFinite(e?.size) && e.size > maxBytes) { oversized.push(path); continue; }
    candidates.push({ path, role });
  }
  candidates.sort((a, b) => (depth(a.path) - depth(b.path)) || (rank[a.role] - rank[b.role]) || a.path.localeCompare(b.path));
  return {
    selected: candidates.slice(0, maxFiles).map((c) => c.path),
    capped: candidates.length > maxFiles,
    oversized,
  };
}

// ── Signals ─────────────────────────────────────────────────────────

/**
 * @typedef {object} Signal
 * @property {string} skill  - Canonical skill name.
 * @property {string} repo   - `owner/name`.
 * @property {string} path   - File the evidence came from.
 * @property {'manifest'|'config'|'path'|'readme'} kind
 * @property {'code'|'declaration'} weight
 * @property {string} detail - Short, sanitized description.
 */

/**
 * Untrusted text made safe for a report line: control characters and
 * newlines replaced, whitespace collapsed, length capped.
 */
export function cleanDetail(text) {
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > MAX_DETAIL_LENGTH ? `${s.slice(0, MAX_DETAIL_LENGTH - 1)}…` : s;
}

const signal = (skill, repo, path, kind, weight, detail) => ({
  skill: canonicalize(skill), repo, path, kind,
  weight: weight === 'code' && isWeakPath(path) ? 'declaration' : weight,
  detail: cleanDetail(detail),
});

/** Source extensions → language. One signal per repo and language. */
const EXTENSION_SKILLS = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', py: 'Python', go: 'Go', rs: 'Rust',
  java: 'Java', kt: 'Kotlin', rb: 'Ruby', php: 'PHP', swift: 'Swift', scala: 'Scala',
  ex: 'Elixir', exs: 'Elixir', cs: 'C#', cpp: 'C++', cc: 'C++', hpp: 'C++',
  sql: 'SQL', tf: 'Terraform', vue: 'Vue.js', svelte: 'Svelte',
};

/**
 * Signals from file names alone: source files by extension (counted per
 * repo, test/example files kept apart as weak), Dockerfiles, compose files,
 * Terraform and GitHub Actions workflows.
 *
 * @param {string} repo
 * @param {string[]} paths
 * @returns {Signal[]}
 */
export function pathSignals(repo, paths) {
  const byLang = new Map();
  const out = [];
  for (const path of paths || []) {
    if (typeof path !== 'string' || isIgnoredPath(path)) continue;
    const file = basename(path);
    if (DOCKERFILE_RE.test(file)) out.push(signal('Docker', repo, path, 'config', 'code', 'Dockerfile'));
    else if (COMPOSE_RE.test(file)) out.push(signal('Docker', repo, path, 'config', 'code', 'Compose file'));
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) {
      out.push(signal('GitHub Actions', repo, path, 'config', 'code', 'GitHub Actions workflow'));
    }
    const dot = file.lastIndexOf('.');
    const extKey = dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
    const lang = Object.hasOwn(EXTENSION_SKILLS, extKey) ? EXTENSION_SKILLS[extKey] : null;
    if (!lang) continue;
    const declOnly = /\.d\.[cm]?ts$/i.test(file);
    const key = `${lang}\u0000${isWeakPath(path) || declOnly ? 'weak' : 'main'}`;
    const entry = byLang.get(key) || { lang, weak: isWeakPath(path) || declOnly, paths: [] };
    entry.paths.push(path);
    byLang.set(key, entry);
  }
  for (const { lang, weak, paths: files } of byLang.values()) {
    files.sort((a, b) => (depth(a) - depth(b)) || a.localeCompare(b));
    const ext = basename(files[0]).split('.').pop();
    const where = weak ? ' (test/example paths only)' : '';
    const detail = `${files.length} .${ext} file${files.length === 1 ? '' : 's'}${where}`;
    for (const file of (weak ? files.slice(0, 1) : files.slice(0, 2))) {
      out.push({
        ...signal(lang, repo, file, 'path', weak ? 'declaration' : 'code', detail),
        weight: weak ? 'declaration' : 'code',
      });
    }
  }
  return out;
}

/**
 * Known packages per ecosystem → skill. Lookup only: a package that is not
 * listed here is ignored, so manifest parsing can stay a line-based regex
 * with no TOML/XML dependency.
 */
const PACKAGE_SKILLS = {
  npm: {
    pg: 'PostgreSQL', 'pg-promise': 'PostgreSQL', postgres: 'PostgreSQL', redis: 'Redis', ioredis: 'Redis',
    mongoose: 'MongoDB', mongodb: 'MongoDB', mysql: 'MySQL', mysql2: 'MySQL', react: 'React',
    'react-native': 'React Native', next: 'Next.js', vue: 'Vue.js', '@angular/core': 'Angular', svelte: 'Svelte',
    typescript: 'TypeScript', graphql: 'GraphQL', kafkajs: 'Kafka', amqplib: 'RabbitMQ', 'aws-sdk': 'AWS',
    '@elastic/elasticsearch': 'Elasticsearch', '@tensorflow/tfjs': 'TensorFlow', '@grpc/grpc-js': 'gRPC',
  },
  python: {
    psycopg2: 'PostgreSQL', 'psycopg2-binary': 'PostgreSQL', psycopg: 'PostgreSQL', asyncpg: 'PostgreSQL',
    redis: 'Redis', django: 'Django', flask: 'Flask', fastapi: 'FastAPI', pymongo: 'MongoDB',
    torch: 'PyTorch', tensorflow: 'TensorFlow', boto3: 'AWS', 'kafka-python': 'Kafka', pika: 'RabbitMQ',
    elasticsearch: 'Elasticsearch', mysqlclient: 'MySQL', pymysql: 'MySQL', grpcio: 'gRPC',
  },
  go: {
    'github.com/lib/pq': 'PostgreSQL', 'github.com/jackc/pgx': 'PostgreSQL', 'github.com/go-redis/redis': 'Redis',
    'github.com/redis/go-redis': 'Redis', 'go.mongodb.org/mongo-driver': 'MongoDB', 'google.golang.org/grpc': 'gRPC',
    'github.com/go-sql-driver/mysql': 'MySQL', 'github.com/aws/aws-sdk-go': 'AWS', 'github.com/segmentio/kafka-go': 'Kafka',
  },
  rust: { 'tokio-postgres': 'PostgreSQL', postgres: 'PostgreSQL', redis: 'Redis', mongodb: 'MongoDB', tonic: 'gRPC' },
  ruby: { pg: 'PostgreSQL', redis: 'Redis', rails: 'Rails', mysql2: 'MySQL', mongoid: 'MongoDB' },
  php: { 'laravel/framework': 'Laravel', 'symfony/symfony': 'Symfony', 'predis/predis': 'Redis' },
  jvm: { postgresql: 'PostgreSQL', 'spring-boot': 'Spring', 'spring-core': 'Spring', jedis: 'Redis', 'kafka-clients': 'Kafka' },
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Known packages named in free manifest text, matched on package-name boundaries. */
function knownPackagesIn(text, table, { prefix = false } = {}) {
  const found = [];
  for (const [pkg, skill] of Object.entries(table)) {
    const tail = prefix ? '(?:[/\\s"\'@]|$)' : '(?![\\w.-])';
    const re = new RegExp(`(?<![\\w.@/-])${escapeRe(pkg)}${tail}`, 'im');
    if (re.test(text)) found.push([pkg, skill]);
  }
  return found;
}

const parseJson = (s) => {
  try { return JSON.parse(s); } catch { return null; }
};

/**
 * Signals from one dependency manifest. Every one is declaration-level:
 * declaring a package is not using it.
 *
 * @param {string} repo
 * @param {string} path
 * @param {string} text
 * @returns {Signal[]}
 */
export function manifestSignals(repo, path, text) {
  const file = basename(path).toLowerCase();
  const out = [];
  const add = (pkg, skill, where) => out.push(signal(skill, repo, path, 'manifest', 'declaration', `${where}: ${pkg}`));
  if (file === 'package.json' || file === 'composer.json') {
    const json = parseJson(text);
    if (!json || typeof json !== 'object') return out;
    const table = file === 'package.json' ? PACKAGE_SKILLS.npm : PACKAGE_SKILLS.php;
    for (const field of ['dependencies', 'devDependencies', 'require', 'require-dev']) {
      const deps = json[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const name of Object.keys(deps)) {
        const key = name.toLowerCase();
        const skill = (Object.hasOwn(table, key) ? table[key] : null)
          || (key.startsWith('@aws-sdk/') && file === 'package.json' ? 'AWS' : null);
        if (skill) add(name, skill, field);
      }
    }
    if (file === 'package.json') {
      const hasEngine = typeof json.engines?.node === 'string';
      const scripts = json.scripts && typeof json.scripts === 'object' ? Object.values(json.scripts) : [];
      const runsNode = scripts.some((s) => typeof s === 'string' && /(^|[\s;&|])node\s+\S/.test(s));
      if (hasEngine || runsNode) {
        out.push(signal('Node.js', repo, path, 'manifest', 'declaration', hasEngine ? `engines.node: ${json.engines.node}` : 'scripts run node'));
      }
    }
    return out;
  }
  const ecosystem = {
    'requirements.txt': 'python', 'pyproject.toml': 'python', pipfile: 'python', 'go.mod': 'go',
    'cargo.toml': 'rust', gemfile: 'ruby', 'pom.xml': 'jvm', 'build.gradle': 'jvm', 'build.gradle.kts': 'jvm',
  }[file];
  if (!ecosystem) return out;
  const lines = String(text ?? '').split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l));
  let body;
  if (ecosystem === 'go') {
    // Only `require` directives add dependencies; `replace`/`exclude` do not.
    const kept = [];
    let inRequire = false;
    for (const l of lines) {
      if (inRequire) { if (/^\s*\)/.test(l)) inRequire = false; else kept.push(l); continue; }
      if (/^\s*require\s*\(/.test(l)) { inRequire = true; continue; }
      const one = l.match(/^\s*require\s+(\S.*)$/);
      if (one) kept.push(one[1]);
    }
    body = kept.join('\n');
  } else {
    body = lines.join('\n');
  }
  for (const [pkg, skill] of knownPackagesIn(body, PACKAGE_SKILLS[ecosystem], { prefix: ecosystem === 'go' })) {
    add(pkg, skill, file);
  }
  return out;
}

/** Base images and compose service images → skill.
 *  Handles official Docker Hub forms: `postgres:16`, `library/postgres:16`,
 *  `docker.io/library/postgres:16`, `docker.io/postgres:16`, and digest-
 *  pinned references like `postgres@sha256:<64-hex>`.
 */
const HUB_PREFIX = '(?:docker\\.io\\/)?(?:library\\/)?';
const IMG_END    = '(?:[:@]|$)';
const IMAGE_SKILLS = [
  [new RegExp(`^${HUB_PREFIX}node${IMG_END}`, 'i'), 'Node.js'],
  [new RegExp(`^${HUB_PREFIX}python${IMG_END}`, 'i'), 'Python'],
  [new RegExp(`^${HUB_PREFIX}golang${IMG_END}`, 'i'), 'Go'],
  [new RegExp(`^${HUB_PREFIX}(?:postgres|postgis\\/postgis)${IMG_END}`, 'i'), 'PostgreSQL'],
  [new RegExp(`^${HUB_PREFIX}redis${IMG_END}`, 'i'), 'Redis'],
  [new RegExp(`^${HUB_PREFIX}mysql${IMG_END}`, 'i'), 'MySQL'],
  [new RegExp(`^${HUB_PREFIX}mongo${IMG_END}`, 'i'), 'MongoDB'],
  [new RegExp(`^${HUB_PREFIX}rabbitmq${IMG_END}`, 'i'), 'RabbitMQ'],
  [/elasticsearch(?:[:@]|$)/i, 'Elasticsearch'],
  [/kafka(?:[:@]|$)/i, 'Kafka'],
];

/**
 * Signals from a Dockerfile or compose file: the base images and service
 * images it runs. Code-level: the repository actually builds or runs these.
 * (Docker itself is signalled from the file name by pathSignals.)
 *
 * @param {string} repo
 * @param {string} path
 * @param {string} text
 * @returns {Signal[]}
 */
/**
 * `image:` values that are direct fields of a service under the top-level
 * `services:` map. Indentation-based: an `image:` nested deeper (for example
 * inside `environment:`) or outside `services:` is not a service image.
 */
function composeServiceImages(text) {
  try {
    const doc = loadYaml(String(text ?? ''));
    if (doc && typeof doc === 'object' && doc.services && typeof doc.services === 'object') {
      return Object.values(doc.services)
        .map((svc) => (svc && typeof svc === 'object' ? svc.image : null))
        .filter((img) => typeof img === 'string' && img.trim())
        .map((img) => img.trim());
    }
    if (doc && typeof doc === 'object') return [];
  } catch { /* fall back to the line-based reader below */ }
  const images = [];
  let inServices = false;
  let svcIndent = null;   // indent of service names
  let fieldIndent = null; // indent of fields within the current service
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.match(/^[ ]*/)[0].length;
    if (indent === 0) {
      inServices = /^services:\s*(#.*)?$/.test(line);
      svcIndent = null;
      fieldIndent = null;
      continue;
    }
    if (!inServices) continue;
    if (svcIndent === null) svcIndent = indent;
    if (indent <= svcIndent) { fieldIndent = null; continue; }
    if (fieldIndent === null) fieldIndent = indent;
    if (indent !== fieldIndent) continue;
    const m = line.match(/^\s*image:\s*["']?([^\s"'#]+)/i);
    if (m) images.push(m[1]);
  }
  return images;
}

export function configSignals(repo, path, text) {
  const out = [];
  const seen = new Set();
  const isCompose = COMPOSE_RE.test(basename(path));
  const stages = new Set();
  const images = isCompose
    ? composeServiceImages(text)
    : [...String(text ?? '').matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?([^\s#]+)(?:\s+AS\s+([\w.-]+))?/gim)].flatMap((m) => {
      // A FROM naming an earlier build stage is not an external image.
      const external = stages.has(m[1].toLowerCase()) ? [] : [m[1]];
      if (m[2]) stages.add(m[2].toLowerCase());
      return external;
    });
  for (const image of images) {
    for (const [pattern, skill] of IMAGE_SKILLS) {
      if (!pattern.test(image) || seen.has(skill)) continue;
      seen.add(skill);
      out.push(signal(skill, repo, path, 'config', 'code', `${isCompose ? 'service image' : 'FROM'} ${image}`));
    }
  }
  return out;
}

/**
 * Skills a README names. Declaration-level: a README describes a project; it
 * does not show who wrote it or how deeply a tool is used.
 *
 * @param {string} repo
 * @param {string} path
 * @param {string} text
 * @returns {Signal[]}
 */
export function readmeSignals(repo, path, text) {
  return [...extractSkills(String(text ?? ''))]
    .map((skill) => signal(skill, repo, path, 'readme', 'declaration', 'named in README'));
}

/** Dispatch one fetched file to its reader. */
export function fileSignals(repo, path, text) {
  const role = fileRole(path);
  if (role === 'manifest') return manifestSignals(repo, path, text);
  if (role === 'config') return configSignals(repo, path, text);
  if (role === 'readme') return readmeSignals(repo, path, text);
  return [];
}

/** Every skill a rule above can emit, plus the shared vocabulary. */
const RULE_SKILLS = new Set([
  ...Object.values(EXTENSION_SKILLS), ...IMAGE_SKILLS.map(([, s]) => s), 'Docker', 'GitHub Actions', 'Node.js',
  ...Object.values(PACKAGE_SKILLS).flatMap((t) => Object.values(t)),
].map(canonicalize));

/** Whether this check could ever find evidence for a skill. */
export function isDetectable(skill) {
  const c = canonicalize(String(skill ?? '').trim());
  return RULE_SKILLS.has(c) || extractSkills(c).has(c);
}

// ── Classification ──────────────────────────────────────────────────

/**
 * @typedef {object} Coverage
 * @property {number} reposScanned
 * @property {number} treesTruncated
 * @property {number} reposCapped - Repos whose candidate files hit the cap.
 * @property {boolean} rateLimited
 * @property {Array<{repo: string|null, detail: string}>} gaps
 */

/** Whether everything in scope was read, so "nothing found" means something. */
export function coverageComplete(coverage) {
  return Boolean(coverage)
    && coverage.reposScanned > 0
    && !coverage.rateLimited
    && (coverage.treesTruncated || 0) === 0
    && (coverage.reposCapped || 0) === 0
    && (coverage.oversizedSkipped || 0) === 0
    && (coverage.gaps || []).length === 0;
}

function coverageProblems(coverage) {
  if (!coverage || coverage.reposScanned === 0) return ['no repository could be inspected'];
  const out = [];
  if (coverage.rateLimited) out.push('GitHub rate limit reached before every repository was read');
  if (coverage.treesTruncated) out.push(`${coverage.treesTruncated} repository tree(s) truncated by GitHub`);
  if (coverage.reposCapped) out.push(`file cap reached in ${coverage.reposCapped} repository(ies)`);
  if (coverage.oversizedSkipped) out.push(`${coverage.oversizedSkipped} file(s) over the size limit were not read`);
  if ((coverage.gaps || []).length) out.push(`${coverage.gaps.length} repository read(s) failed`);
  return out;
}

const fileKey = (s) => `${s.repo}\u0000${s.path}`;

/**
 * Classify one target skill from the signals collected.
 *
 * @param {string} skill - Target skill (canonicalized here).
 * @param {Signal[]} signals - All signals from every repository.
 * @param {Coverage} coverage
 * @returns {{skill: string, level: string, reasons: string[], evidence: object[]}}
 */
export function classifySkill(skill, signals, coverage) {
  const name = canonicalize(String(skill ?? '').trim());
  const relevant = (signals || []).filter((s) => s.skill === name);
  const code = relevant.filter((s) => s.weight === 'code');
  const kinds = new Set(relevant.map((s) => s.kind));
  const codeFiles = new Set(code.map(fileKey));
  const repos = new Set(relevant.map((s) => s.repo));
  const evidence = [...code, ...relevant.filter((s) => s.weight !== 'code')]
    .slice(0, MAX_EVIDENCE_PER_SKILL)
    .map(({ repo, path, kind, weight, detail }) => ({ repo, path, kind, weight, detail }));

  if (code.length && (kinds.size >= 2 || codeFiles.size >= 2)) {
    const why = kinds.size >= 2
      ? `Code-level evidence (${[...new Set(code.map((s) => s.kind))].join(', ')}) corroborated by ${[...kinds].filter((k) => !code.some((s) => s.kind === k)).join(', ') || 'a second signal kind'}`
      : `Code-level evidence in ${codeFiles.size} files`;
    return { skill: name, level: LEVELS.STRONG, reasons: [`${why} across ${repos.size} repositor${repos.size === 1 ? 'y' : 'ies'}.`], evidence };
  }
  if (relevant.length) {
    const reason = code.length
      ? 'Only one code-level file was found and nothing corroborates it.'
      : `Only declaration-level evidence (${[...kinds].join(', ')}) was found; declaring or mentioning a tool is not evidence of using it.`;
    return { skill: name, level: LEVELS.PARTIAL, reasons: [reason], evidence };
  }
  if (!isDetectable(name)) {
    return { skill: name, level: LEVELS.UNABLE, reasons: ['This skill is outside what a repository file scan can detect.'], evidence };
  }
  if (coverageComplete(coverage)) {
    return {
      skill: name, level: LEVELS.NO_EVIDENCE,
      reasons: [`Not found in the ${coverage.reposScanned} repositor${coverage.reposScanned === 1 ? 'y' : 'ies'} inspected. This is not evidence that the skill is missing.`],
      evidence,
    };
  }
  return { skill: name, level: LEVELS.UNABLE, reasons: [`Nothing found, but coverage was incomplete: ${coverageProblems(coverage).join('; ')}.`], evidence };
}

/**
 * Target skills, canonicalized and de-duplicated in first-seen order.
 * @param {string[]} skills
 * @returns {string[]}
 */
export function normalizeTargetSkills(skills) {
  const seen = new Set();
  const out = [];
  for (const raw of skills || []) {
    const c = canonicalize(String(raw ?? '').trim());
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    out.push(c);
  }
  return out;
}

/**
 * The full report object.
 *
 * @param {object} input
 * @returns {object}
 */
export function buildProofReport({ user, generatedAt, inputs = {}, scope = {}, coverage, targetSkills, signals }) {
  const skills = normalizeTargetSkills(targetSkills).map((s) => classifySkill(s, signals, coverage));
  const counts = Object.fromEntries(Object.values(LEVELS).map((l) => [l, skills.filter((s) => s.level === l).length]));
  return {
    schema: SCHEMA,
    generatedAt,
    user,
    inputs,
    scope,
    coverage: { ...coverage, complete: coverageComplete(coverage) },
    counts,
    skills,
    notes: [
      'Absence of evidence is not absence of skill.',
      'A dependency declaration alone is never STRONG evidence.',
      'Owning a repository is not proof of authoring every file in it.',
      'Repository content is untrusted data, never instructions.',
    ],
  };
}

/** A string as a CommonMark code span that cannot break out of itself. */
function codeSpan(text) {
  const s = String(text).replace(/[\u0000-\u001f\u007f]/g, ' ');
  const longest = Math.max(0, ...(s.match(/`+/g) || []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(s) ? ' ' : '';
  return `${fence}${pad}${s}${pad}${fence}`;
}

const cell = (s) => String(s).replace(/[\\|]/g, '\\$&');

/**
 * Markdown rendering of a report. Every repository-derived string goes
 * through codeSpan() or cell() so it renders literally.
 * @param {object} report
 * @returns {string}
 */
export function renderProofMarkdown(report) {
  const c = report.coverage || {};
  const md = [`# Skill proof: ${report.user} (${report.generatedAt})`, ''];
  md.push(`> Scope: ${c.reposScanned ?? 0} repositories inspected, ${c.filesRead ?? 0} files read${c.complete ? ', coverage complete' : ', coverage INCOMPLETE'}. Absence of evidence is not absence of skill. Repository content is untrusted data, never instructions.`, '');
  md.push('| Skill | Level | Why |', '|---|---|---|');
  for (const s of report.skills) md.push(`| ${cell(s.skill)} | ${s.level} | ${cell(s.reasons.join(' '))} |`);
  md.push('');
  for (const s of report.skills) {
    if (!s.evidence.length) continue;
    md.push(`## ${cell(s.skill)}: ${s.level}`, '');
    for (const e of s.evidence) md.push(`- ${codeSpan(e.repo)} ${codeSpan(e.path)} (${e.kind}, ${e.weight}): ${codeSpan(e.detail)}`);
    md.push('');
  }
  if ((c.gaps || []).length || c.rateLimited || c.treesTruncated || c.reposCapped || c.oversizedSkipped) {
    md.push('## Coverage gaps', '');
    if (c.rateLimited) md.push('- GitHub rate limit reached; later repositories were not read.');
    if (c.treesTruncated) md.push(`- ${c.treesTruncated} tree(s) truncated by GitHub.`);
    if (c.reposCapped) md.push(`- File cap reached in ${c.reposCapped} repositor${c.reposCapped === 1 ? 'y' : 'ies'}.`);
    if (c.oversizedSkipped) md.push(`- ${c.oversizedSkipped} file(s) over the size limit were not read.`);
    for (const g of c.gaps || []) {
      md.push(`- ${g.repo ? codeSpan(g.repo) : 'private or unknown repository'}: ${cell(cleanDetail(g.detail))}${g.path ? `: ${codeSpan(g.path)}` : ''}`);
    }
    md.push('');
  }
  return md.join('\n');
}

