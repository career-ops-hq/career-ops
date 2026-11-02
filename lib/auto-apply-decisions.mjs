import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function readDecisions(dataRoot) {
  const file = join(dataRoot, 'output/auto-apply/decisions.json');
  let raw;
  try { raw = readFileSync(file, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return new Map(); throw error; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('auto-apply decisions.json is malformed JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.decisions) || !parsed.decisions.every(x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.url === 'string' && ['approve', 'skip'].includes(x.decision) && typeof x.ts === 'string' && Number.isFinite(Date.parse(x.ts)))) throw new Error('auto-apply decisions.json has an invalid shape');
  return new Map(parsed.decisions.map(x => [x.url, x.decision]));
}

export function writeDecisions(dataRoot, decisions) {
  const file = join(dataRoot, 'output/auto-apply/decisions.json');
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.decisions.${process.pid}.${randomUUID()}.tmp`);
  try { writeFileSync(tmp, `${JSON.stringify({ decisions }, null, 2)}\n`, 'utf8'); renameSync(tmp, file); }
  catch (error) { try { rmSync(tmp, { force: true }); } catch {} throw error; }
}
