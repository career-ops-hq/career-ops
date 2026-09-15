// SQLite source of truth for an opportunity from discovery through its outcome.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function openOpportunityStore(path) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { throw new Error('SQLite opportunity workflow requires Node >=22.5'); }
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, company TEXT NOT NULL,
      role TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered' CHECK(state IN ('discovered','evaluating','eligible','ineligible','evaluated')),
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
  if (!db.prepare('PRAGMA table_info(deliveries)').all().some(column => column.name === 'status')) db.exec("ALTER TABLE deliveries ADD COLUMN status TEXT NOT NULL DEFAULT 'claimed'");
  const event = (id, type, payload = {}) => db.prepare('INSERT INTO opportunity_events (opportunity_id, type, payload) VALUES (?, ?, ?)').run(id, type, JSON.stringify(payload));
  const state = id => db.prepare('SELECT state FROM opportunities WHERE id = ?').get(id)?.state;
  const requireState = (id, expected) => {
    if (state(id) !== expected) throw new Error(`Opportunity ${id} must be ${expected}`);
  };
  return {
    ingest({ url, company, role, source, payload }) {
      db.prepare('INSERT INTO opportunities (url, company, role, source) VALUES (?, ?, ?, ?) ON CONFLICT(url) DO NOTHING').run(url, company, role, source);
      const row = db.prepare('SELECT id, url FROM opportunities WHERE url = ?').get(url);
      const exists = db.prepare('SELECT 1 FROM source_evidence WHERE opportunity_id = ? AND source = ?').get(row.id, source);
      if (!exists) { db.prepare('INSERT INTO source_evidence (opportunity_id, source, payload) VALUES (?, ?, ?)').run(row.id, source, JSON.stringify(payload)); event(row.id, 'discovered', { source }); }
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
    opportunity(id) {
      const row = db.prepare('SELECT id, url, company, role, source, state FROM opportunities WHERE id = ?').get(id);
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
