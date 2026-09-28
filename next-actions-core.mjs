/** Durable candidate actions. This module never writes the application tracker. */
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { LockTimeoutError, withPipelineLock } from './pipeline-lock.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { isHeaderRow, isSeparatorRow, parseTrackerRow, resolveColumns } from './tracker-parse.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const MAX_IMPORT_BYTES = 1024 * 1024;
const STATES = ['proposed', 'open', 'done', 'dismissed'];
const ACTORS = ['user', 'company', 'unknown'];
const EDIT_FIELDS = ['title', 'actor', 'evidence', 'links', 'employerDue', 'targetDate', 'snoozedUntil'];
const SNAPSHOT_FIELDS = ['state', ...EDIT_FIELDS, 'application', 'acknowledgedImports'];
const PROPOSAL_FIELDS = ['source', 'title', 'actor', 'evidence', 'employerDue', 'links'];
const OPERATIONS = ['accept', 'done', 'dismiss', 'reopen', 'edit', 'bind', 'unbind', 'ack-source'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const GROUP_NAMES = ['needs-review', 'overdue', 'due-today', 'ready', 'waiting', 'snoozed', 'done', 'dismissed'];

export class ActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

function invalid(message) { throw new ActionError('VALIDATION', message); }
function assert(condition, message) { if (!condition) invalid(message); }
function object(value, allowed, required = allowed) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object.');
  assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Expected a plain object.');
  assert(Object.keys(value).every(key => allowed.includes(key)), 'Unknown field in action data.');
  assert(required.every(key => Object.hasOwn(value, key)), 'Required action field is missing.');
}

function text(value, max, { empty = false, multiline = false } = {}) {
  assert(typeof value === 'string' && value.length <= max, 'Invalid text field or text exceeds its size limit.');
  assert(empty || value.trim().length > 0, 'Text field cannot be empty.');
  const checked = multiline ? value.replace(/[\n\r\t]/g, '') : value;
  assert(!CONTROL_RE.test(checked), 'Text contains control characters.');
  return value;
}

function enumeration(value, values) {
  assert(values.includes(value), 'Unknown action enum value.');
  return value;
}

function positiveRevision(value) {
  assert(Number.isSafeInteger(value) && value > 0, 'Revision must be a positive safe integer.');
  return value;
}

function date(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Date must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  assert(year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1], 'Date is not a real calendar date.');
  return value;
}

function zone(value) {
  assert(typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/.test(value), 'Time zone must be an IANA name.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); }
  catch { invalid('Time zone must be a supported IANA name.'); }
  return value;
}

function instant(value) {
  assert(typeof value === 'string', 'Instant must be a string.');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  assert(match, 'Instant requires full seconds and an explicit Z or numeric offset.');
  date(match[1]);
  assert(Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59, 'Instant contains an invalid time.');
  if (match[6] !== 'Z') {
    const hours = Number(match[6].slice(1, 3));
    const minutes = Number(match[6].slice(4, 6));
    assert(hours <= 14 && minutes <= 59 && (hours !== 14 || minutes === 0), 'Instant contains an invalid offset.');
  }
  const normalized = new Date(value).toISOString();
  assert(/^\d{4}-/.test(normalized) && !normalized.startsWith('0000-'), 'Instant falls outside the supported year range.');
  return normalized;
}

function nowInstant(now) {
  assert(now instanceof Date && Number.isFinite(now.getTime()), 'now must be a valid Date.');
  return instant(now.toISOString());
}

function safeRelative(value) {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  return !decoded.includes('\\') && !decoded.startsWith('/') && !/^[A-Za-z]:/.test(decoded)
    && !CONTROL_RE.test(decoded) && decoded.split('/').every(part => part && part !== '.' && part !== '..');
}

function reference(value) {
  text(value, 2048);
  if (value.startsWith('local:')) {
    assert(safeRelative(value.slice(6)), 'Local reference must be relative to the Data Root without traversal.');
    return value;
  }
  assert(/^https?:\/\//i.test(value) && !value.includes('\\'), 'Reference must be HTTP(S) or local:DataRoot-relative.');
  let parsed;
  try { parsed = new URL(value); } catch { invalid('Reference is not a valid URL.'); }
  assert(['http:', 'https:'].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password, 'Reference URL must not contain credentials.');
  return value;
}

function source(value) {
  object(value, ['namespace', 'eventId', 'actionKey']);
  return { namespace: text(value.namespace, 200), eventId: text(value.eventId, 200), actionKey: text(value.actionKey, 200) };
}

function evidence(value) {
  object(value, ['text', 'ref'], ['text']);
  return { text: text(value.text, 2000, { multiline: true }), ref: value.ref == null ? null : reference(value.ref) };
}

function due(value) {
  assert(value !== null && typeof value === 'object', 'Employer due must be an object.');
  if (value.kind === 'unknown') {
    object(value, ['kind', 'text']);
    return { kind: 'unknown', text: text(value.text, 2000, { empty: true, multiline: true }) };
  }
  if (value.kind === 'date') {
    object(value, ['kind', 'date', 'timeZone', 'text']);
    return { kind: 'date', date: date(value.date), timeZone: value.timeZone === null ? null : zone(value.timeZone), text: text(value.text, 2000, { multiline: true }) };
  }
  object(value, ['kind', 'at', 'text']);
  assert(value.kind === 'instant', 'Unknown employer due kind.');
  return { kind: 'instant', at: instant(value.at), text: text(value.text, 2000, { multiline: true }) };
}

function links(value) {
  assert(Array.isArray(value) && value.length <= 10, 'Links must be an array of at most 10 references.');
  return value.map(link => {
    object(link, ['label', 'ref']);
    return { label: text(link.label, 120), ref: reference(link.ref) };
  });
}

function proposal(value) {
  object(value, PROPOSAL_FIELDS, ['source', 'title', 'evidence']);
  return {
    source: source(value.source), title: text(value.title, 240),
    actor: enumeration(value.actor === undefined ? 'unknown' : value.actor, ACTORS),
    evidence: evidence(value.evidence),
    employerDue: due(value.employerDue === undefined ? { kind: 'unknown', text: '' } : value.employerDue),
    links: links(value.links === undefined ? [] : value.links),
  };
}

function target(value) {
  if (value === null) return null;
  object(value, ['date', 'timeZone']);
  return { date: date(value.date), timeZone: zone(value.timeZone) };
}

function trackerId(value) {
  assert(typeof value === 'string' && /^\d+$/.test(value) && value.length <= 200, 'Tracker ID must be a positive digit string.');
  const normalized = BigInt(value).toString();
  assert(normalized !== '0', 'Tracker ID must be positive.');
  return normalized;
}

function binding(value) {
  if (value === null) return null;
  object(value, ['trackerPath', 'trackerId', 'company', 'role', 'report', 'postingUrl']);
  text(value.trackerPath, 4096);
  // A saved reference is metadata, including when its Data Root moves between
  // Windows and POSIX. Only the current active tracker is ever opened.
  assert(posix.isAbsolute(value.trackerPath) || win32.isAbsolute(value.trackerPath) || safeRelative(value.trackerPath), 'Invalid saved tracker path.');
  return {
    trackerPath: value.trackerPath, trackerId: trackerId(value.trackerId),
    company: text(value.company, 2000, { empty: true }), role: text(value.role, 2000, { empty: true }),
    report: text(value.report, 4096, { empty: true }), postingUrl: text(value.postingUrl, 4096, { empty: true }),
  };
}

function snapshot(value) {
  object(value, SNAPSHOT_FIELDS);
  assert(Array.isArray(value.acknowledgedImports), 'Acknowledged imports must be an array.');
  return {
    state: enumeration(value.state, STATES), title: text(value.title, 240), actor: enumeration(value.actor, ACTORS),
    evidence: evidence(value.evidence), links: links(value.links), employerDue: due(value.employerDue),
    targetDate: target(value.targetDate), snoozedUntil: value.snoozedUntil === null ? null : instant(value.snoozedUntil),
    application: binding(value.application), acknowledgedImports: value.acknowledgedImports.map(proposal),
  };
}

function currentSnapshot(task) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map(field => [field, structuredClone(task[field])]));
}

function initialSnapshot(imported) {
  return {
    state: 'proposed', title: imported.title, actor: imported.actor, evidence: structuredClone(imported.evidence),
    links: structuredClone(imported.links), employerDue: structuredClone(imported.employerDue),
    targetDate: null, snoozedUntil: null, application: null, acknowledgedImports: [],
  };
}

function sameSource(left, right) { return isDeepStrictEqual(left, right); }
function sourceKey(value) { return JSON.stringify([value.namespace, value.eventId, value.actionKey]); }
function isPending(state) { return state === 'proposed' || state === 'open'; }

function validateTransition(before, after, operation, at) {
  const allowed = operation === 'edit' ? EDIT_FIELDS : operation === 'ack-source' ? ['acknowledgedImports']
    : ['bind', 'unbind'].includes(operation) ? ['application'] : ['state'];
  assert(SNAPSHOT_FIELDS.filter(field => !allowed.includes(field)).every(field => isDeepStrictEqual(before[field], after[field])), 'Revision changes fields outside its operation.');
  assert(!isDeepStrictEqual(before, after), 'Revision must record a real change.');
  if (operation === 'accept') assert(before.state === 'proposed' && after.state === 'open', 'Only a proposed action can be accepted.');
  else if (operation === 'done') assert(before.state === 'open' && after.state === 'done', 'Only an open action can be completed.');
  else if (operation === 'dismiss') assert(isPending(before.state) && after.state === 'dismissed', 'Only a pending action can be dismissed.');
  else if (operation === 'reopen') assert(!isPending(before.state) && after.state === 'proposed', 'Only a closed action can be reopened.');
  else if (operation === 'edit') {
    assert(isPending(before.state), 'Reopen a closed action before editing it.');
    if (!isDeepStrictEqual(before.snoozedUntil, after.snoozedUntil) && after.snoozedUntil !== null) {
      assert(before.state === 'open', 'Only open actions can be snoozed.');
      assert(after.snoozedUntil > at, 'Snooze must be in the future.');
    }
  } else if (operation === 'bind' || operation === 'unbind') {
    assert(isPending(before.state), 'Reopen a closed action before changing its binding.');
    assert(operation === 'bind' ? after.application !== null : after.application === null, 'Invalid binding transition.');
  } else if (operation === 'ack-source') {
    assert(after.acknowledgedImports.length === before.acknowledgedImports.length + 1
      && isDeepStrictEqual(after.acknowledgedImports.slice(0, -1), before.acknowledgedImports), 'Acknowledgement must append one reviewed input.');
  } else invalid('Unknown revision operation.');
}

function validateTask(value) {
  object(value, ['id', 'revision', 'source', 'imported', ...SNAPSHOT_FIELDS, 'createdAt', 'updatedAt', 'history']);
  assert(typeof value.id === 'string' && UUID_RE.test(value.id), 'Invalid action UUID.');
  positiveRevision(value.revision);
  const imported = proposal(value.imported);
  const canonicalSource = source(value.source);
  assert(sameSource(canonicalSource, imported.source), 'Task source differs from its imported source.');
  const mutable = snapshot(currentSnapshot(value));
  const seenInputs = new Set([JSON.stringify(imported)]);
  for (const input of mutable.acknowledgedImports) {
    assert(sameSource(input.source, canonicalSource), 'Acknowledged input has a different source.');
    const key = JSON.stringify(input);
    assert(!seenInputs.has(key), 'Repeated canonical input in acknowledgements.');
    seenInputs.add(key);
  }
  const createdAt = instant(value.createdAt);
  const updatedAt = instant(value.updatedAt);
  assert(Array.isArray(value.history) && value.history.length === value.revision, 'History length differs from revision.');
  let previous;
  const history = value.history.map((entry, index) => {
    object(entry, ['revision', 'at', 'operation', 'reason', 'after']);
    assert(entry.revision === index + 1, 'History revisions must be contiguous.');
    const at = instant(entry.at);
    const reason = text(entry.reason, 500, { multiline: true });
    const after = snapshot(entry.after);
    if (index === 0) {
      assert(entry.operation === 'import' && isDeepStrictEqual(after, initialSnapshot(imported)), 'First revision must derive from the original proposal.');
      assert(createdAt === at, 'Creation time differs from first revision.');
    } else {
      enumeration(entry.operation, OPERATIONS);
      validateTransition(previous, after, entry.operation, at);
    }
    previous = after;
    return { revision: entry.revision, at, operation: entry.operation, reason, after };
  });
  assert(updatedAt === history.at(-1).at && isDeepStrictEqual(previous, mutable), 'Current task differs from its last revision.');
  const normalized = { id: value.id, revision: value.revision, source: canonicalSource, imported, ...mutable, createdAt, updatedAt, history };
  assert(isDeepStrictEqual(normalized, value), 'Stored action is not canonical.');
  return normalized;
}

function validateStore(value) {
  object(value, ['schemaVersion', 'tasks']);
  assert(value.schemaVersion === 1 && Array.isArray(value.tasks), 'Unsupported action store schema.');
  const ids = new Set();
  const sources = new Set();
  const tasks = value.tasks.map(raw => {
    const task = validateTask(raw);
    const key = sourceKey(task.source);
    assert(!ids.has(task.id) && !sources.has(key), 'Action IDs and source tuples must be unique.');
    ids.add(task.id);
    sources.add(key);
    return task;
  });
  return { schemaVersion: 1, tasks };
}

function ioError(error, message = 'Action storage operation failed.') {
  if (error instanceof ActionError) return error;
  if (error instanceof LockTimeoutError) return new ActionError('LOCK_TIMEOUT', 'Action store is busy; retry after the other writer finishes.');
  return new ActionError('IO', message);
}

// Realpath the existing ancestor even before first-run directories exist.
function canonicalPath(path, unavailableOK = false) {
  const absolute = resolve(path);
  try { return realpathSync(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT' && !unavailableOK) throw error;
    const parent = dirname(absolute);
    if (parent === absolute) {
      if (unavailableOK) return absolute;
      throw error;
    }
    return join(canonicalPath(parent, unavailableOK), basename(absolute));
  }
}

function storePath(path) {
  const canonical = join(canonicalPath(dirname(path)), basename(path));
  try {
    const stat = lstatSync(canonical);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new ActionError('STORE_INVALID', 'Action store must be a regular file, not a symlink.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return canonical;
}

/** @returns {{dataRoot:string, storePath:string, trackerPath:string}} */
export function createActionsContext({ dataRoot, codeRoot = CODE_ROOT, trackerPath } = {}) {
  try {
    text(codeRoot, 4096);
    const resolvedCodeRoot = resolve(codeRoot);
    let root = dataRoot;
    if (root === undefined) {
      if (resolvedCodeRoot === CODE_ROOT) root = getCareerOpsRoot();
      else {
        root = process.env.CAREER_OPS_ROOT?.trim() || process.env.CAREER_OPS_DATA_DIR?.trim();
        const marker = join(resolvedCodeRoot, '.career-ops-data');
        if (!root && existsSync(marker)) root = readFileSync(marker, 'utf8').trim();
        root ||= resolvedCodeRoot;
      }
    }
    text(root, 4096);
    const resolvedRoot = canonicalPath(resolve(resolvedCodeRoot, root));
    const override = trackerPath ?? process.env.CAREER_OPS_TRACKER?.trim();
    if (override !== undefined && override !== '') text(override, 4096);
    // Canonicalize reachable ancestors even when this read-only dependency is
    // unavailable. Store/root resolution stays strict; bind reports read errors
    // and list marks affected bindings for review without gating other actions.
    const activeTracker = canonicalPath(override ? resolve(resolvedCodeRoot, override) : resolveTrackerPath(resolvedRoot), true);
    return { dataRoot: resolvedRoot, storePath: storePath(join(resolvedRoot, 'data', 'next-actions.json')), trackerPath: activeTracker };
  } catch (error) { throw ioError(error, 'Cannot resolve action storage paths.'); }
}

/** Read and validate without creating a directory or a store. @returns {{schemaVersion:1,tasks:object[]}} */
export function readActions(context) {
  let content;
  try {
    const path = storePath(context.storePath);
    let descriptor;
    try { descriptor = openSync(path, 'r'); }
    catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, tasks: [] }; throw error; }
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile()) throw new ActionError('STORE_INVALID', 'Action store must be a regular file.');
      if (stat.size > MAX_STORE_BYTES) throw new ActionError('STORE_INVALID', 'Action store exceeds the 16 MiB limit.');
      const chunks = [];
      let total = 0;
      for (;;) {
        // Bound the read itself, including a file that grows after fstat.
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_STORE_BYTES + 1 - total));
        const count = readSync(descriptor, chunk, 0, chunk.length, null);
        if (count === 0) break;
        total += count;
        if (total > MAX_STORE_BYTES) throw new ActionError('STORE_INVALID', 'Action store exceeds the 16 MiB limit.');
        chunks.push(chunk.subarray(0, count));
      }
      content = Buffer.concat(chunks, total);
    } finally { closeSync(descriptor); }
  } catch (error) { throw ioError(error, 'Cannot read action store.'); }
  try { return validateStore(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content))); }
  catch { throw new ActionError('STORE_INVALID', 'Action store is malformed, inconsistent, or uses an unsupported schema. Restore a known good copy before writing.'); }
}

async function transaction(context, apply) {
  try {
    const path = storePath(context.storePath);
    mkdirSync(dirname(path), { recursive: true });
    const canonical = storePath(path);
    return await withPipelineLock(canonical, () => {
      assert(storePath(canonical) === canonical, 'Action store path changed while acquiring its lock.');
      const store = readActions({ ...context, storePath: canonical });
      const result = apply(store);
      if (result.changed) {
        validateStore(store);
        const content = JSON.stringify(store, null, 2) + '\n';
        assert(Buffer.byteLength(content) <= MAX_STORE_BYTES, 'Action store would exceed the 16 MiB limit; no changes written.');
        storePath(canonical);
        writeFileAtomic(canonical, content);
      }
      return result.value;
    });
  } catch (error) { throw ioError(error); }
}

function newTask(imported, at) {
  const mutable = initialSnapshot(imported);
  return {
    id: randomUUID(), revision: 1, source: structuredClone(imported.source), imported,
    ...mutable, createdAt: at, updatedAt: at,
    history: [{ revision: 1, at, operation: 'import', reason: 'Imported for review.', after: structuredClone(mutable) }],
  };
}

/** @returns {Promise<{created:object[],unchanged:object[],dryRun:boolean}>} */
export async function importActions(context, proposals, { dryRun = false, now = new Date() } = {}) {
  assert(typeof dryRun === 'boolean', 'dryRun must be boolean.');
  assert(Array.isArray(proposals) && proposals.length <= 500, 'Import must be an array with at most 500 proposals.');
  let serialized;
  try { serialized = JSON.stringify(proposals); } catch { invalid('Import must be JSON-serializable.'); }
  assert(Buffer.byteLength(serialized) <= MAX_IMPORT_BYTES, 'Import exceeds the 1 MiB limit.');
  const inputs = proposals.map(proposal);
  const at = nowInstant(now);
  const apply = store => {
    const existing = new Map(store.tasks.map(task => [sourceKey(task.source), task]));
    const created = [];
    const unchanged = [];
    const returned = new Set();
    for (const input of inputs) {
      const key = sourceKey(input.source);
      const found = existing.get(key);
      if (found) {
        if (![found.imported, ...found.acknowledgedImports].some(known => isDeepStrictEqual(known, input))) {
          throw new ActionError('CONFLICT', `Action ${found.id} already exists with different source input. Review it, then use edit and/or ack-source with the current revision.`);
        }
        if (!returned.has(key)) unchanged.push(found);
      } else {
        const task = newTask(input, at);
        store.tasks.push(task);
        existing.set(key, task);
        created.push(task);
      }
      returned.add(key);
    }
    return { changed: created.length > 0, value: { created, unchanged, dryRun } };
  };
  if (dryRun) {
    const store = readActions(context);
    const result = apply(store);
    validateStore(store);
    assert(Buffer.byteLength(JSON.stringify(store, null, 2) + '\n') <= MAX_STORE_BYTES, 'Action store would exceed the 16 MiB limit.');
    return result.value;
  }
  return transaction(context, apply);
}

function activeTrackerLabel(context) {
  const path = canonicalPath(context.trackerPath, true);
  const rel = relative(canonicalPath(context.dataRoot), path);
  return rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel) ? rel.split(sep).join('/') : path;
}

function readTracker(context) {
  const lines = readFileSync(context.trackerPath, 'utf8').split(/\r?\n/);
  const columns = resolveColumns(lines);
  const postingColumn = columns.url ?? columns.applylink;
  const rows = new Map();
  const label = activeTrackerLabel(context);
  for (const line of lines) {
    if (!line.startsWith('|') || isHeaderRow(line) || isSeparatorRow(line)) continue;
    const cells = line.split('|').map(cell => cell.trim());
    const rawId = cells[columns.num];
    if (['N/A', '—', '-'].includes(rawId)) continue;
    const id = trackerId(rawId);
    const parsed = parseTrackerRow(line, columns);
    assert(parsed, 'Tracker contains an incomplete row.');
    assert(!rows.has(id), 'Tracker contains duplicate IDs; repair the tracker before binding.');
    rows.set(id, binding({ trackerPath: label, trackerId: id, company: parsed.company, role: parsed.role,
      report: parsed.report, postingUrl: postingColumn === undefined ? '' : cells[postingColumn] }));
  }
  return rows;
}

function patchSnapshot(before, patch) {
  object(patch, EDIT_FIELDS, []);
  assert(Object.keys(patch).length > 0, 'Edit patch cannot be empty.');
  return snapshot({ ...before, ...patch });
}

/** @returns {Promise<object>} Updated task, or unchanged task for a normalized no-op. */
export async function updateAction(context, id, command, { now = new Date() } = {}) {
  assert(typeof id === 'string' && UUID_RE.test(id), 'Invalid action UUID.');
  object(command, ['operation', 'expectedRevision', 'reason', 'patch', 'trackerId', 'proposal'], ['operation', 'expectedRevision', 'reason']);
  const operation = enumeration(command.operation, OPERATIONS);
  const expectedRevision = positiveRevision(command.expectedRevision);
  const reason = text(command.reason, 500, { multiline: true });
  const payloadField = operation === 'edit' ? 'patch' : operation === 'bind' ? 'trackerId' : operation === 'ack-source' ? 'proposal' : null;
  assert(['patch', 'trackerId', 'proposal'].every(field => !Object.hasOwn(command, field) || field === payloadField), 'Payload is not valid for this operation.');
  if (payloadField) assert(Object.hasOwn(command, payloadField), 'Operation payload is required.');
  const at = nowInstant(now);
  return transaction(context, store => {
    const task = store.tasks.find(candidate => candidate.id === id);
    if (!task) throw new ActionError('NOT_FOUND', 'Action was not found.');
    if (task.revision !== expectedRevision) throw new ActionError('CONFLICT', 'Action revision changed. Read the current action and review before retrying.');
    const before = currentSnapshot(task);
    let after = structuredClone(before);
    if (operation === 'edit') {
      assert(isPending(before.state), 'Reopen a closed action before editing it.');
      after = patchSnapshot(before, command.patch);
    } else if (operation === 'bind' || operation === 'unbind') {
      assert(isPending(before.state), 'Reopen a closed action before changing its binding.');
      if (operation === 'unbind') after.application = null;
      else {
        const requested = trackerId(command.trackerId);
        let rows;
        try { rows = readTracker(context); }
        catch (error) {
          if (error.code === 'ENOENT') throw new ActionError('NOT_FOUND', 'Active tracker was not found.');
          throw ioError(error, 'Cannot read the active tracker.');
        }
        if (!rows.has(requested)) throw new ActionError('NOT_FOUND', 'Tracker ID was not found in the active tracker.');
        after.application = rows.get(requested);
      }
    } else if (operation === 'ack-source') {
      const input = proposal(command.proposal);
      assert(sameSource(task.source, input.source), 'Acknowledged input must have the same source tuple.');
      if (![task.imported, ...task.acknowledgedImports].some(known => isDeepStrictEqual(known, input))) after.acknowledgedImports.push(input);
    } else {
      after.state = { accept: 'open', done: 'done', dismiss: 'dismissed', reopen: 'proposed' }[operation];
      // Repeating a lifecycle verb is not a retry contract: only imported inputs
      // and explicitly normalized edits/acknowledgements can be no-ops.
      validateTransition(before, after, operation, at);
    }
    if (isDeepStrictEqual(before, after)) return { changed: false, value: task };
    validateTransition(before, after, operation, at);
    assert(task.revision < Number.MAX_SAFE_INTEGER, 'Action revision limit reached.');
    Object.assign(task, after, { revision: task.revision + 1, updatedAt: at });
    task.history.push({ revision: task.revision, at, operation, reason, after: structuredClone(after) });
    return { changed: true, value: task };
  });
}

function dateInZone(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = type => parts.find(value => value.type === type).value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

function bindingLimited(application) {
  const absent = value => !value || ['N/A', '—', '-'].includes(value);
  return application !== null && absent(application.report) && absent(application.postingUrl);
}

function project(task, { now, at, timeZone, trackerLabel, rows, trackerState }) {
  const employerDueUnknown = task.employerDue.kind === 'unknown';
  const employerTimeZoneUnknown = task.employerDue.kind === 'date' && task.employerDue.timeZone === null;
  let employerOverdue = false;
  let employerDueToday = false;
  if (task.employerDue.kind === 'instant') {
    employerOverdue = task.employerDue.at < at;
    employerDueToday = dateInZone(new Date(task.employerDue.at), timeZone) === dateInZone(now, timeZone);
  } else if (task.employerDue.kind === 'date' && task.employerDue.timeZone !== null) {
    const today = dateInZone(now, task.employerDue.timeZone);
    employerOverdue = task.employerDue.date < today;
    employerDueToday = task.employerDue.date === today;
  }
  const targetToday = task.targetDate === null ? null : dateInZone(now, task.targetDate.timeZone);
  const targetReached = targetToday !== null && task.targetDate.date <= targetToday;
  const targetPast = targetToday !== null && task.targetDate.date < targetToday;
  const requestedSnoozeActive = task.snoozedUntil !== null && task.snoozedUntil > at;
  const snoozeOverridden = requestedSnoozeActive && (employerOverdue || employerDueToday || targetReached);
  let snoozePastEmployerDue = false;
  if (requestedSnoozeActive && task.employerDue.kind === 'instant') {
    snoozePastEmployerDue = task.snoozedUntil > task.employerDue.at;
  } else if (requestedSnoozeActive && task.employerDue.kind === 'date' && task.employerDue.timeZone !== null) {
    snoozePastEmployerDue = dateInZone(new Date(task.snoozedUntil), task.employerDue.timeZone) > task.employerDue.date;
  }
  let bindingState = 'unbound';
  if (task.application !== null) {
    if (task.application.trackerPath !== trackerLabel) bindingState = 'other-tracker';
    else if (trackerState !== 'current') bindingState = trackerState;
    else if (!rows.has(task.application.trackerId)) bindingState = 'missing';
    else bindingState = isDeepStrictEqual(task.application, rows.get(task.application.trackerId)) ? 'current' : 'changed';
  }
  const flags = {
    employerOverdue, employerDueToday, employerDueUnknown, employerTimeZoneUnknown, targetReached, targetPast,
    requestedSnoozeActive, snoozeOverridden, snoozePastEmployerDue, bindingState, bindingLimited: bindingLimited(task.application),
    ageDays: Math.max(0, Math.floor((now.getTime() - new Date(task.createdAt).getTime()) / 86400000)),
  };
  let bucket;
  if (!isPending(task.state)) bucket = task.state;
  else if (task.state === 'proposed' || task.actor === 'unknown' || !['unbound', 'current'].includes(bindingState)) bucket = 'needs-review';
  else if (task.actor === 'company') bucket = 'waiting';
  else if (employerOverdue) bucket = 'overdue';
  else if (employerDueToday) bucket = 'due-today';
  else if (requestedSnoozeActive && !snoozeOverridden) bucket = 'snoozed';
  else bucket = 'ready';
  const current = { ...task };
  delete current.history;
  delete current.imported;
  delete current.acknowledgedImports;
  return { ...current, flags, bucket };
}

/**
 * Compact current-state projection; readActions retains original inputs/history.
 * Groups map bucket names to UUID arrays; counts has the same keys plus total.
 * @returns {object}
 */
export function listActions(context, { includeClosed = false, timeZone = 'UTC', now = new Date() } = {}) {
  assert(typeof includeClosed === 'boolean', 'includeClosed must be boolean.');
  zone(timeZone);
  const at = nowInstant(now);
  const store = readActions(context);
  const selected = store.tasks.filter(task => includeClosed || isPending(task.state));
  let trackerLabel;
  try { trackerLabel = activeTrackerLabel(context); }
  catch (error) { throw ioError(error, 'Cannot resolve the active tracker.'); }
  let rows = new Map();
  let trackerState = 'current';
  if (selected.some(task => task.application?.trackerPath === trackerLabel)) {
    try { rows = readTracker(context); }
    catch (error) {
      trackerState = error.code === 'ENOENT' ? 'missing' : error instanceof ActionError ? 'tracker-invalid' : 'tracker-unavailable';
    }
  }
  const tasks = selected.map(task => project(task, { now, at, timeZone, trackerLabel, rows, trackerState }));
  tasks.sort((left, right) => GROUP_NAMES.indexOf(left.bucket) - GROUP_NAMES.indexOf(right.bucket)
    || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const groups = Object.fromEntries(GROUP_NAMES.map(name => [name, []]));
  for (const task of tasks) groups[task.bucket].push(task.id);
  const counts = { total: tasks.length, ...Object.fromEntries(GROUP_NAMES.map(name => [name, groups[name].length])) };
  return { schemaVersion: 1, timeZone, asOf: at, counts, groups, tasks };
}
