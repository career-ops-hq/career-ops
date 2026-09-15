// SQLite source of truth for an opportunity from discovery through its outcome.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export async function openOpportunityStore(path) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { throw new Error('SQLite opportunity workflow requires Node >=22.5'); }
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, company TEXT NOT NULL,
      role TEXT NOT NULL, identity TEXT NOT NULL UNIQUE, source TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered' CHECK(state IN ('discovered','evaluating','eligible','ineligible','evaluated')),
      application_state TEXT NOT NULL DEFAULT 'none' CHECK(application_state IN ('none','preparing','submitted')),
      claimed_by TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS source_evidence (
      id INTEGER PRIMARY KEY, opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
      source TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS eligibility (
      opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id), status TEXT NOT NULL CHECK(status IN ('pass','fail','unknown')),
      evidence TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id), lower_score REAL NOT NULL,
      upper_score REAL NOT NULL, coverage REAL NOT NULL, report_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY, opportunity_id INTEGER NOT NULL REFERENCES opportunities(id), kind TEXT NOT NULL,
      path TEXT NOT NULL, sha256 TEXT NOT NULL, UNIQUE(opportunity_id, kind, path)
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      opportunity_id INTEGER NOT NULL REFERENCES opportunities(id), phase TEXT NOT NULL,
      input_hash TEXT NOT NULL, output_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(opportunity_id, phase)
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      opportunity_id INTEGER NOT NULL REFERENCES opportunities(id), channel TEXT NOT NULL,
      report_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','delivered')), delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(opportunity_id, channel, report_hash)
    );
    CREATE TABLE IF NOT EXISTS scan_outcomes (
      url TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY, operation TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS source_health (
      id INTEGER PRIMARY KEY, scan_run_id INTEGER NOT NULL REFERENCES scan_runs(id), source TEXT NOT NULL, status TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS page_evidence (
      opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id), content TEXT NOT NULL, content_hash TEXT NOT NULL,
      captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS repost_inputs (
      opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id), fingerprint TEXT NOT NULL, first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS opportunity_events (
      id INTEGER PRIMARY KEY, opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
      type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TRIGGER IF NOT EXISTS eligibility_requires_evaluating
    BEFORE INSERT ON eligibility WHEN (SELECT state FROM opportunities WHERE id = NEW.opportunity_id) != 'evaluating'
    BEGIN SELECT RAISE(ABORT, 'eligibility requires evaluating opportunity'); END;
    CREATE TRIGGER IF NOT EXISTS evaluation_requires_eligible
    BEFORE INSERT ON evaluations WHEN (SELECT state FROM opportunities WHERE id = NEW.opportunity_id) != 'eligible'
    BEGIN SELECT RAISE(ABORT, 'evaluation requires eligible opportunity'); END;
    CREATE TRIGGER IF NOT EXISTS artifact_requires_evaluated
    BEFORE INSERT ON artifacts WHEN (SELECT state FROM opportunities WHERE id = NEW.opportunity_id) != 'evaluated'
    BEGIN SELECT RAISE(ABORT, 'artifact requires evaluated opportunity'); END;
    CREATE TRIGGER IF NOT EXISTS delivery_requires_evaluated
    BEFORE INSERT ON deliveries WHEN (SELECT state FROM opportunities WHERE id = NEW.opportunity_id) != 'evaluated'
    BEGIN SELECT RAISE(ABORT, 'delivery requires evaluated opportunity'); END;
  `);
  if (!db.prepare('PRAGMA table_info(opportunities)').all().some(column => column.name === 'attempts')) db.exec('ALTER TABLE opportunities ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(opportunities)').all().some(column => column.name === 'application_state')) db.exec("ALTER TABLE opportunities ADD COLUMN application_state TEXT NOT NULL DEFAULT 'none'");
  if (!db.prepare('PRAGMA table_info(opportunities)').all().some(column => column.name === 'identity')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN identity TEXT');
    const used = new Set();
    for (const row of db.prepare('SELECT id, company, role FROM opportunities ORDER BY id').all()) {
      const base = `${String(row.company).normalize('NFKC').trim().toLowerCase()}::${String(row.role).normalize('NFKC').trim().toLowerCase()}`;
      const value = used.has(base) ? `${base}#${row.id}` : base;
      used.add(base);
      db.prepare('UPDATE opportunities SET identity = ? WHERE id = ?').run(value, row.id);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS opportunities_identity ON opportunities(identity)');
  }
  if (!db.prepare('PRAGMA table_info(deliveries)').all().some(column => column.name === 'status')) db.exec("ALTER TABLE deliveries ADD COLUMN status TEXT NOT NULL DEFAULT 'claimed'");
  const event = (id, type, payload = {}) => db.prepare('INSERT INTO opportunity_events (opportunity_id, type, payload) VALUES (?, ?, ?)').run(id, type, JSON.stringify(payload));
  const state = id => db.prepare('SELECT state FROM opportunities WHERE id = ?').get(id)?.state;
  const requireState = (id, expected) => {
    if (state(id) !== expected) throw new Error(`Opportunity ${id} must be ${expected}`);
  };
  const identity = (company, role) => `${String(company).normalize('NFKC').trim().toLowerCase()}::${String(role).normalize('NFKC').trim().toLowerCase()}`;
  return {
    ingest({ url, company, role, source, payload }) {
      const key = identity(company, role);
      db.prepare('INSERT INTO opportunities (url, company, role, identity, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').run(url, company, role, key, source);
      let row = db.prepare('SELECT id, url FROM opportunities WHERE url = ?').get(url);
      if (!row) row = db.prepare("SELECT id, url FROM opportunities WHERE identity = ? OR substr(identity, 1, length(?) + 1) = ? || '#' ORDER BY id LIMIT 1").get(key, key, key);
      const exists = db.prepare('SELECT 1 FROM source_evidence WHERE opportunity_id = ? AND source = ?').get(row.id, source);
      if (!exists) { db.prepare('INSERT INTO source_evidence (opportunity_id, source, payload) VALUES (?, ?, ?)').run(row.id, source, JSON.stringify(payload)); event(row.id, 'discovered', { source }); }
      if (typeof payload?.description === 'string' && payload.description.trim()) db.prepare('INSERT INTO page_evidence (opportunity_id, content, content_hash) VALUES (?, ?, ?) ON CONFLICT(opportunity_id) DO NOTHING').run(row.id, payload.description, createHash('sha256').update(payload.description).digest('hex'));
      if (typeof payload?.fingerprint === 'string' && payload.fingerprint) db.prepare('INSERT INTO repost_inputs (opportunity_id, fingerprint) VALUES (?, ?) ON CONFLICT(opportunity_id) DO NOTHING').run(row.id, payload.fingerprint);
      return row;
    },
    claim(id, worker) {
      const result = db.prepare("UPDATE opportunities SET state = 'evaluating', claimed_by = ?, attempts = attempts + 1 WHERE id = ? AND state = 'discovered'").run(worker, id);
      if (result.changes) event(id, 'claimed', { worker });
      return result.changes === 1;
    },
    claimUrl(url, worker) {
      const row = db.prepare('SELECT id FROM opportunities WHERE url = ?').get(url);
      return row && this.claim(row.id, worker) ? this.opportunity(row.id) : null;
    },
    claimNext(worker) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare("SELECT id, url, company, role, source FROM opportunities WHERE state = 'discovered' ORDER BY id LIMIT 1").get();
        if (!row || !db.prepare("UPDATE opportunities SET state = 'evaluating', claimed_by = ?, attempts = attempts + 1 WHERE id = ? AND state = 'discovered'").run(worker, row.id).changes) {
          db.exec('COMMIT');
          return null;
        }
        event(row.id, 'claimed', { worker });
        db.exec('COMMIT');
        return row;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    resume(worker) {
      const row = db.prepare("SELECT id, url, company, role, source FROM opportunities WHERE state = 'evaluating' AND claimed_by = ? AND attempts < 2 ORDER BY id LIMIT 1").get(worker);
      if (row) {
        db.prepare('UPDATE opportunities SET attempts = attempts + 1 WHERE id = ?').run(row.id);
        event(row.id, 'resumed', { worker });
      }
      return row ?? null;
    },
    urls() { return this.dedupRows().map(row => row.url); },
    dedupRows() {
      return [
        ...db.prepare("SELECT url, company, role, CASE WHEN state = 'discovered' THEN 'added' ELSE 'processed' END AS status, substr(created_at, 1, 10) AS firstSeen FROM opportunities").all(),
        ...db.prepare('SELECT url, status, substr(created_at, 1, 10) AS firstSeen FROM scan_outcomes').all(),
      ];
    },
    recordScanOutcomes(outcomes) {
      for (const { url, status, ...payload } of outcomes) db.prepare('INSERT INTO scan_outcomes (url, status, payload) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET status = excluded.status, payload = excluded.payload').run(url, status, JSON.stringify(payload));
    },
    recordScanRun(operation, summary, health = []) {
      const run = db.prepare('INSERT INTO scan_runs (operation, summary) VALUES (?, ?)').run(operation, JSON.stringify(summary));
      for (const row of health) db.prepare('INSERT INTO source_health (scan_run_id, source, status, checked_at) VALUES (?, ?, ?, ?)').run(run.lastInsertRowid, row.company ?? row.source, row.status, row.timestamp);
      return Number(run.lastInsertRowid);
    },
    healthRecords() { return db.prepare('SELECT checked_at AS timestamp, source AS company, status FROM source_health ORDER BY id').all(); },
    fingerprintHistory() { return db.prepare('SELECT o.url, substr(r.first_seen, 1, 10) AS dateStr, o.company, o.role AS title, r.fingerprint FROM repost_inputs r JOIN opportunities o ON o.id = r.opportunity_id').all(); },
    opportunity(id) {
      const row = db.prepare('SELECT id, url, company, role, source, state, application_state AS applicationState FROM opportunities WHERE id = ?').get(id);
      if (!row) return null;
      return { ...row, evidence: db.prepare('SELECT source, payload FROM source_evidence WHERE opportunity_id = ? ORDER BY id').all(id).map(item => ({ source: item.source, payload: JSON.parse(item.payload) })) };
    },
    recordEligibility(id, { status, evidence }) {
      requireState(id, 'evaluating');
      db.prepare('INSERT INTO eligibility (opportunity_id, status, evidence) VALUES (?, ?, ?)').run(id, status, JSON.stringify(evidence));
      db.prepare("UPDATE opportunities SET state = ? WHERE id = ?").run(status === 'fail' ? 'ineligible' : 'eligible', id);
      event(id, 'eligibility_recorded', { status });
    },
    recordEvaluation(id, { lower, upper, coverage, reportHash }) {
      requireState(id, 'eligible');
      db.prepare('INSERT INTO evaluations (opportunity_id, lower_score, upper_score, coverage, report_hash) VALUES (?, ?, ?, ?, ?)').run(id, lower, upper, coverage, reportHash);
      db.prepare("UPDATE opportunities SET state = 'evaluated' WHERE id = ?").run(id);
      event(id, 'evaluation_recorded', { reportHash });
    },
    recordArtifact(id, { kind, path, sha256 }) {
      requireState(id, 'evaluated');
      db.prepare('INSERT INTO artifacts (opportunity_id, kind, path, sha256) VALUES (?, ?, ?, ?) ON CONFLICT(opportunity_id, kind, path) DO UPDATE SET sha256 = excluded.sha256').run(id, kind, path, sha256);
      event(id, 'artifact_recorded', { kind, path });
    },
    startApplication(id) {
      const result = db.prepare("UPDATE opportunities SET application_state = 'preparing' WHERE id = ? AND state = 'evaluated' AND application_state = 'none' AND EXISTS (SELECT 1 FROM eligibility WHERE opportunity_id = opportunities.id AND status = 'pass')").run(id);
      if (!result.changes) throw new Error(`Opportunity ${id} must be an unstarted shortlist opportunity`);
      event(id, 'application_started');
      return this.opportunity(id);
    },
    recordApplicationArtifact(id, { kind, path, sha256 }) {
      if (kind === 'verified-application-pdf') throw new Error('Use recordVerifiedApplicationPdf for verified PDFs');
      if (state(id) !== 'evaluated' || db.prepare('SELECT application_state FROM opportunities WHERE id = ?').get(id)?.application_state !== 'preparing') throw new Error(`Opportunity ${id} must be in application preparation`);
      db.prepare('INSERT INTO artifacts (opportunity_id, kind, path, sha256) VALUES (?, ?, ?, ?) ON CONFLICT(opportunity_id, kind, path) DO UPDATE SET sha256 = excluded.sha256').run(id, kind, path, sha256);
      event(id, 'application_artifact_recorded', { kind, path, sha256 });
    },
    recordVerifiedApplicationPdf(id, { path, sha256 }) {
      if (state(id) !== 'evaluated' || db.prepare('SELECT application_state FROM opportunities WHERE id = ?').get(id)?.application_state !== 'preparing') throw new Error(`Opportunity ${id} must be in application preparation`);
      if (!db.prepare("SELECT 1 FROM artifacts WHERE opportunity_id = ? AND kind = 'application-pdf' AND path = ? AND sha256 = ?").get(id, path, sha256)) throw new Error(`Opportunity ${id} PDF must match its rendered application artifact`);
      db.prepare('INSERT INTO artifacts (opportunity_id, kind, path, sha256) VALUES (?, ?, ?, ?) ON CONFLICT(opportunity_id, kind, path) DO UPDATE SET sha256 = excluded.sha256').run(id, 'verified-application-pdf', path, sha256);
      event(id, 'application_pdf_verified', { path, sha256 });
    },
    confirmSubmitted(id, confirmation) {
      if (confirmation !== 'submitted') throw new Error('Submission requires explicit confirmation: submitted');
      if (!db.prepare("SELECT 1 FROM artifacts rendered JOIN artifacts verified ON verified.opportunity_id = rendered.opportunity_id AND verified.path = rendered.path AND verified.sha256 = rendered.sha256 WHERE rendered.opportunity_id = ? AND rendered.kind = 'application-pdf' AND verified.kind = 'verified-application-pdf'").get(id)) throw new Error(`Opportunity ${id} requires a current verified application PDF`);
      const result = db.prepare("UPDATE opportunities SET application_state = 'submitted' WHERE id = ? AND state = 'evaluated' AND application_state = 'preparing'").run(id);
      if (!result.changes) throw new Error(`Opportunity ${id} must be in application preparation`);
      event(id, 'application_submitted');
      return this.opportunity(id);
    },
    saveCheckpoint(id, phase, inputHash, outputHash) {
      if (!['evaluating', 'eligible', 'evaluated', 'ineligible'].includes(state(id))) throw new Error(`Opportunity ${id} cannot save a checkpoint`);
      db.prepare("INSERT INTO checkpoints (opportunity_id, phase, input_hash, output_hash) VALUES (?, ?, ?, ?) ON CONFLICT(opportunity_id, phase) DO UPDATE SET input_hash = excluded.input_hash, output_hash = excluded.output_hash").run(id, phase, inputHash, outputHash);
      event(id, 'checkpoint_saved', { phase, outputHash });
    },
    checkpoint(id, phase) { return db.prepare('SELECT input_hash, output_hash FROM checkpoints WHERE opportunity_id = ? AND phase = ?').get(id, phase); },
    claimDelivery(id, channel, reportHash) {
      requireState(id, 'evaluated');
      db.prepare("DELETE FROM deliveries WHERE opportunity_id = ? AND channel = ? AND report_hash = ? AND status = 'claimed' AND delivered_at < datetime('now', '-5 minutes')").run(id, channel, reportHash);
      const result = db.prepare("INSERT INTO deliveries (opportunity_id, channel, report_hash, status) VALUES (?, ?, ?, 'claimed') ON CONFLICT DO NOTHING").run(id, channel, reportHash);
      if (result.changes) event(id, 'delivery_claimed', { channel, reportHash });
      return result.changes === 1;
    },
    releaseDelivery(id, channel, reportHash) {
      const result = db.prepare("DELETE FROM deliveries WHERE opportunity_id = ? AND channel = ? AND report_hash = ? AND status = 'claimed'").run(id, channel, reportHash);
      if (result.changes) event(id, 'delivery_released', { channel, reportHash });
      return result.changes === 1;
    },
    completeDelivery(id, channel, reportHash) {
      const result = db.prepare("UPDATE deliveries SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP WHERE opportunity_id = ? AND channel = ? AND report_hash = ? AND status = 'claimed'").run(id, channel, reportHash);
      if (result.changes) event(id, 'delivery_completed', { channel, reportHash });
      return result.changes === 1;
    },
    publish(id, { eligibility, evaluation, artifact, checkpoint }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        requireState(id, 'evaluating');
        db.prepare('INSERT INTO eligibility (opportunity_id, status, evidence) VALUES (?, ?, ?)').run(id, 'pass', JSON.stringify(eligibility));
        db.prepare("UPDATE opportunities SET state = 'eligible' WHERE id = ?").run(id);
        db.prepare('INSERT INTO evaluations (opportunity_id, lower_score, upper_score, coverage, report_hash) VALUES (?, ?, ?, ?, ?)').run(id, evaluation.lower, evaluation.upper, evaluation.coverage, evaluation.reportHash);
        db.prepare("UPDATE opportunities SET state = 'evaluated' WHERE id = ?").run(id);
        db.prepare('INSERT INTO artifacts (opportunity_id, kind, path, sha256) VALUES (?, ?, ?, ?)').run(id, artifact.kind, artifact.path, artifact.sha256);
        db.prepare('INSERT INTO checkpoints (opportunity_id, phase, input_hash, output_hash) VALUES (?, ?, ?, ?) ON CONFLICT(opportunity_id, phase) DO UPDATE SET input_hash = excluded.input_hash, output_hash = excluded.output_hash').run(id, checkpoint.phase, checkpoint.inputHash, checkpoint.outputHash);
        event(id, 'published', { reportHash: evaluation.reportHash });
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    discard(id, { evidence, checkpoint }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        requireState(id, 'evaluating');
        db.prepare('INSERT INTO eligibility (opportunity_id, status, evidence) VALUES (?, ?, ?)').run(id, 'fail', JSON.stringify(evidence));
        db.prepare("UPDATE opportunities SET state = 'ineligible' WHERE id = ?").run(id);
        db.prepare('INSERT INTO checkpoints (opportunity_id, phase, input_hash, output_hash) VALUES (?, ?, ?, ?) ON CONFLICT(opportunity_id, phase) DO UPDATE SET input_hash = excluded.input_hash, output_hash = excluded.output_hash').run(id, checkpoint.phase, checkpoint.inputHash, checkpoint.outputHash);
        event(id, 'discarded', evidence);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    shortlist() { return db.prepare("SELECT o.id, o.url, o.company, o.role, e.lower_score, e.upper_score, e.coverage, e.report_hash FROM opportunities o JOIN eligibility g ON g.opportunity_id = o.id AND g.status = 'pass' JOIN evaluations e ON e.opportunity_id = o.id ORDER BY e.lower_score DESC").all(); },
    events(id) { return db.prepare('SELECT type, payload FROM opportunity_events WHERE opportunity_id = ? ORDER BY id').all(id); },
    close() { db.close(); },
  };
}
