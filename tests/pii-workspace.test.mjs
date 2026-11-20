// tests/pii-workspace.test.mjs — tests for pii-workspace tokenization tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  scrub,
  rehydrate,
  loadTokenMap,
  saveTokenMap,
  replaceUserFile,
  isTokenKey,
} from '../pii-workspace.mjs';

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-ws-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('scrub allocates YAML-safe tokens and reuses only on exact case match', () => {
  const mockGuard = {
    textValues: new Set(['jordan placeholder', 'project nightingale']),
  };
  const map = {};

  const text = 'Candidate Jordan Placeholder worked on Project Nightingale. Another Jordan Placeholder.';
  const scrubbed = scrub(text, mockGuard, map);

  assert.match(scrubbed, /PRIVACY_VALUE_1/);
  assert.match(scrubbed, /PRIVACY_VALUE_2/);
  // Unquoted scalar validity: no braces, colons, or quotes
  assert.doesNotMatch(scrubbed, /[{}[\]:"]/);

  // Exact spelling match reuses token (jordan placeholder is processed second due to length)
  assert.equal(scrubbed.match(/PRIVACY_VALUE_2/g).length, 2);

  // Case difference allocates separate token
  const differentCase = 'Small jordan placeholder was here.';
  const scrubbedDiff = scrub(differentCase, mockGuard, map);
  assert.match(scrubbedDiff, /PRIVACY_VALUE_3/);
  assert.equal(map['PRIVACY_VALUE_3'], 'jordan placeholder');
});

test('scrub processes guard.textValues longest first using sorted copy without mutating guard', () => {
  const originalOrder = ['jordan', 'jordan placeholder'];
  const mockGuard = {
    textValues: new Set(originalOrder),
  };
  const map = {};
  const text = 'Candidate Jordan Placeholder arrived today.';
  const scrubbed = scrub(text, mockGuard, map);

  // Entire phrase 'Jordan Placeholder' should be tokenized as one token, not 'PRIVACY_VALUE_1 Placeholder'
  assert.equal(scrubbed, 'Candidate PRIVACY_VALUE_1 arrived today.');
  assert.equal(map['PRIVACY_VALUE_1'], 'Jordan Placeholder');
  // Original Set iteration order preserved
  assert.deepEqual([...mockGuard.textValues], originalOrder);
});

test('scrub never matches a configured value inside a token, new or existing', () => {
  const mockGuard = { textValues: new Set(['Jane Smith', 'value']) };

  // A new token must not be scrubbed again by a shorter value that it contains.
  const map = {};
  const scrubbed = scrub('Contact: Jane Smith', mockGuard, map);
  assert.equal(scrubbed, 'Contact: PRIVACY_VALUE_1');
  assert.deepEqual(map, { PRIVACY_VALUE_1: 'Jane Smith' });
  assert.equal(rehydrate(scrubbed, map), 'Contact: Jane Smith');

  // A file scrubbed before keeps its tokens intact on a second scrub.
  const rescrubbed = scrub('PRIVACY_VALUE_1 wrote it; Jane Smith signed it.', mockGuard, map);
  assert.equal(rescrubbed, 'PRIVACY_VALUE_1 wrote it; PRIVACY_VALUE_1 signed it.');
  assert.deepEqual(map, { PRIVACY_VALUE_1: 'Jane Smith' });

  // Legacy tokens from the map are kept too.
  const legacyMap = { __NAME__: 'Jane Smith' };
  assert.equal(scrub('__NAME__ (Jane Smith)', { textValues: new Set(['Jane Smith', '__NAME']) }, legacyMap), '__NAME__ (__NAME__)');
});

test('scrub handles numeric-only guard without throwing', () => {
  const mockGuard = {
    textValues: new Set(),
    digitStrings: new Set(['150000']),
    digitRuns: new Set(['150000']),
  };
  const map = {};
  const text = 'Base salary: 150000';
  const scrubbed = scrub(text, mockGuard, map);
  assert.equal(scrubbed, 'Base salary: 150000');
  assert.equal(Object.keys(map).length, 0);
});

test('scrub resumes searching after start of rejected overlapping match to scrub later occurrence', () => {
  const mockGuard = {
    textValues: new Set(['professor anna', 'anna anna']),
  };
  const map = {};
  const text = 'Professor Anna Anna Anna';
  const scrubbed = scrub(text, mockGuard, map);

  // 'Professor Anna' is scrubbed as PRIVACY_VALUE_1.
  // The first 'Anna Anna' overlaps with 'Professor Anna' and is rejected.
  // Resuming after start finds the later non-overlapping 'Anna Anna'.
  assert.equal(scrubbed, 'PRIVACY_VALUE_1 PRIVACY_VALUE_2');
  assert.equal(map['PRIVACY_VALUE_1'], 'Professor Anna');
  assert.equal(map['PRIVACY_VALUE_2'], 'Anna Anna');

  // Verify rehydration restores the original text
  const restored = rehydrate(scrubbed, map);
  assert.equal(restored, text);
});

test('scrub matches against original text so placeholder tokens are never processed as input', () => {
  // If guard has 'value' (>= 5 chars) which matches inside 'PRIVACY_VALUE_1'
  const mockGuard = {
    textValues: new Set(['jane doe', 'value']),
  };
  const map = {};
  const text = 'Jane Doe';
  const scrubbed = scrub(text, mockGuard, map);
  assert.equal(scrubbed, 'PRIVACY_VALUE_1');
  assert.equal(map['PRIVACY_VALUE_1'], 'Jane Doe');
  assert.equal(map['PRIVACY_VALUE_2'], undefined);
});

test('rehydrate performs single-pass lookup avoiding prefix corruption for overlapping tokens', () => {
  const map = {
    PRIVACY_VALUE_1: 'Alice',
    PRIVACY_VALUE_10: 'Bob',
    PRIVACY_VALUE_100: 'Charlie',
  };

  // Text contains PRIVACY_VALUE_10 and PRIVACY_VALUE_100
  const input = 'First: PRIVACY_VALUE_1, Tenth: PRIVACY_VALUE_10, Hundredth: PRIVACY_VALUE_100.';
  const restored = rehydrate(input, map);

  assert.equal(restored, 'First: Alice, Tenth: Bob, Hundredth: Charlie.');
  // Must not produce corrupted forms like "Alice0"
  assert.doesNotMatch(restored, /Alice0/);
});

test('rehydrate handles legacy tokens in descending length order', () => {
  const map = {
    SHORT: 'short_val',
    SHORT_EXTRA: 'long_val',
  };

  const input = 'Tokens: SHORT_EXTRA and SHORT.';
  const restored = rehydrate(input, map);

  assert.equal(restored, 'Tokens: long_val and short_val.');
  assert.doesNotMatch(restored, /short_val_EXTRA/);
});

test('rehydrate matches numeric and legacy tokens in a single pass without re-processing inserted values', () => {
  const map = {
    TOKEN_A: 'value with TOKEN_B inside',
    TOKEN_B: 'replaced_val',
    PRIVACY_VALUE_1: 'value with PRIVACY_VALUE_2 inside',
    PRIVACY_VALUE_2: 'another_val',
  };

  const input = 'Test: TOKEN_A and PRIVACY_VALUE_1.';
  const restored = rehydrate(input, map);

  assert.equal(restored, 'Test: value with TOKEN_B inside and value with PRIVACY_VALUE_2 inside.');
  assert.doesNotMatch(restored, /replaced_val/);
  assert.doesNotMatch(restored, /another_val/);
});

test('replaceUserFile writes atomically and preserves file mode', () => {
  withTempDir((dir) => {
    const target = path.join(dir, 'test.txt');
    fs.writeFileSync(target, 'initial', { mode: 0o644 });
    const expectedMode = fs.statSync(target).mode & 0o777;

    replaceUserFile(target, 'updated');
    assert.equal(fs.readFileSync(target, 'utf8'), 'updated');

    // On non-Windows platforms verify mode preservation
    if (process.platform !== 'win32') {
      const mode = fs.statSync(target).mode & 0o777;
      assert.equal(mode, expectedMode);
    }
  });
});

test('replaceUserFile preserves restrictive mode (0o600) set via chmodSync', () => {
  withTempDir((dir) => {
    const target = path.join(dir, 'restrictive.txt');
    fs.writeFileSync(target, 'initial');
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      /* ignore on platforms where chmod is not supported */
    }

    replaceUserFile(target, 'updated');
    assert.equal(fs.readFileSync(target, 'utf8'), 'updated');

    if (process.platform !== 'win32') {
      const mode = fs.statSync(target).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  });
});

test('replaceUserFile cleans up temporary file on successful write', () => {
  withTempDir((dir) => {
    const target = path.join(dir, 'test.txt');
    replaceUserFile(target, 'hello');
    assert.equal(fs.readFileSync(target, 'utf8'), 'hello');
    const tempFiles = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`.${path.basename(target)}.`) && f.endsWith('.tmp'));
    assert.equal(tempFiles.length, 0, 'no temporary files left after success');
  });
});

test('replaceUserFile cleans up temporary file if write fails', () => {
  withTempDir((dir) => {
    // Pointing target to an existing directory forces write/rename to fail (EISDIR / EPERM)
    const target = path.join(dir, 'dir_as_target');
    fs.mkdirSync(target);

    assert.throws(() => replaceUserFile(target, 'hello'));
    const tempFiles = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`.${path.basename(target)}.`) && f.endsWith('.tmp'));
    assert.equal(tempFiles.length, 0, 'no temporary files left after failed write');
  });
});

test('replaceUserFile preserves symlink target and updates destination', (t) => {
  withTempDir((dir) => {
    const realTarget = path.join(dir, 'real.txt');
    const symlinkTarget = path.join(dir, 'symlink.txt');
    fs.writeFileSync(realTarget, 'original content', 'utf8');
    try {
      fs.symlinkSync(realTarget, symlinkTarget);
    } catch {
      t.skip('symlinks not supported on this platform/privilege level');
      return;
    }

    replaceUserFile(symlinkTarget, 'updated content');
    assert.equal(fs.readFileSync(realTarget, 'utf8'), 'updated content');
    assert.equal(fs.lstatSync(symlinkTarget).isSymbolicLink(), true);
  });
});

test('saveTokenMap cleans up temporary file on successful write', () => {
  withTempDir((dir) => {
    const target = path.join(dir, 'test.json');
    saveTokenMap({ test: 'hello' }, target);
    assert.deepEqual(loadTokenMap(target), { test: 'hello' });
    const tempFiles = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`.${path.basename(target)}.`) && f.endsWith('.tmp'));
    assert.equal(tempFiles.length, 0, 'no temporary files left after success');
  });
});

test('saveTokenMap cleans up temporary file if write fails', () => {
  withTempDir((dir) => {
    // Pointing target to an existing directory forces write/rename to fail (EISDIR / EPERM)
    const target = path.join(dir, 'dir_as_target');
    fs.mkdirSync(target);

    assert.throws(() => saveTokenMap({ test: 'hello' }, target));
    const tempFiles = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`.${path.basename(target)}.`) && f.endsWith('.tmp'));
    assert.equal(tempFiles.length, 0, 'no temporary files left after failed write');
  });
});

test('loadTokenMap throws error on corrupt or invalid token map file', () => {
  withTempDir((dir) => {
    const corruptFile = path.join(dir, 'corrupt-map.json');
    fs.writeFileSync(corruptFile, 'not valid json {', 'utf8');
    assert.throws(() => loadTokenMap(corruptFile), /Error reading token map/);

    const arrayFile = path.join(dir, 'array-map.json');
    fs.writeFileSync(arrayFile, '["an", "array"]', 'utf8');
    assert.throws(() => loadTokenMap(arrayFile), /invalid token map structure/);

    const absentFile = path.join(dir, 'absent-map.json');
    assert.deepEqual(loadTokenMap(absentFile), {});
  });
});

test('pii-workspace.mjs --help and -h print usage and exit 0', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  for (const flag of ['--help', '-h']) {
    const res = spawnSync(process.execPath, [path.join(root, 'pii-workspace.mjs'), flag], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^Usage: node pii-workspace\.mjs <scrub\|restore\|status>/);
  }
});

test('restore removes token map when completed with none unresolved and keeps it if unresolved remain', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');

    // Case 1: All tokens resolved -> token map removed
    fs.writeFileSync(tokenMap, JSON.stringify({ PRIVACY_VALUE_1: 'Alice' }), 'utf8');
    fs.writeFileSync(cvFile, 'Candidate: PRIVACY_VALUE_1', 'utf8');

    const resClean = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(resClean.status, 0);
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Alice');
    assert.equal(fs.existsSync(tokenMap), false, 'token map should be removed after clean restore');

    // Case 2: Unresolved tokens remain -> token map kept
    fs.writeFileSync(tokenMap, JSON.stringify({ PRIVACY_VALUE_1: 'Alice' }), 'utf8');
    fs.writeFileSync(cvFile, 'Candidate: PRIVACY_VALUE_1 and PRIVACY_VALUE_99', 'utf8');

    const resUnresolved = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(resUnresolved.status, 0);
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Alice and PRIVACY_VALUE_99');
    assert.equal(fs.existsSync(tokenMap), true, 'token map should be preserved when tokens remain unresolved');
  });
});

test('restore retains token map when entries remain unaccounted for in restored files', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');

    // Token map has 2 entries, but cv.md only has PRIVACY_VALUE_1 and other user files are absent
    fs.writeFileSync(
      tokenMap,
      JSON.stringify({ PRIVACY_VALUE_1: 'Alice', PRIVACY_VALUE_2: 'SecretCompany' }),
      'utf8'
    );
    fs.writeFileSync(cvFile, 'Candidate: PRIVACY_VALUE_1', 'utf8');

    const res = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(res.status, 0);
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Alice');
    assert.equal(fs.existsSync(tokenMap), true, 'token map must be kept when map entries remain unaccounted for');
    assert.match(res.stderr + res.stdout, /1 token map entry\(ies\) not restored; retaining/);
  });
});

test('restore reports deletion failure and sets nonzero exit code when token map cannot be unlinked', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');

    fs.writeFileSync(tokenMap, JSON.stringify({ PRIVACY_VALUE_1: 'Alice' }), 'utf8');
    fs.writeFileSync(cvFile, 'Candidate: PRIVACY_VALUE_1', 'utf8');

    const scriptUrl = pathToFileURL(scriptPath).href;
    const preload = `
      import fs from 'node:fs';
      const orig = fs.unlinkSync;
      fs.unlinkSync = (p) => {
        if (typeof p === 'string' && p.includes('.pii-token-map.json')) {
          const err = new Error('simulated permission denied');
          err.code = 'EPERM';
          throw err;
        }
        return orig(p);
      };
      process.argv = [process.argv[0], ${JSON.stringify(scriptPath)}, 'restore'];
      await import(${JSON.stringify(scriptUrl)});
    `;

    const res = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', preload],
      {
        encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_ROOT: dir },
      }
    );

    assert.equal(res.status, 1, 'process must exit nonzero on deletion failure');
    assert.match(res.stderr + res.stdout, /Error removing token map at/);
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Alice', 'file should still be restored');
    assert.equal(fs.existsSync(tokenMap), true, 'token map remains on disk after failed unlink');
  });
});

test('restore retains token map when a tokenized file is absent even if all keys were restored from another file', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');

    // Token map recorded cv.md and config/profile.yml as tokenized; both shared PRIVACY_VALUE_1
    fs.writeFileSync(
      tokenMap,
      JSON.stringify({
        __files__: ['cv.md', 'config/profile.yml'],
        PRIVACY_VALUE_1: 'Alice',
      }),
      'utf8'
    );
    // cv.md is present and contains PRIVACY_VALUE_1; config/profile.yml is absent
    fs.writeFileSync(cvFile, 'Candidate: PRIVACY_VALUE_1', 'utf8');

    const res = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(res.status, 0);
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Alice');
    assert.equal(fs.existsSync(tokenMap), true, 'token map must be kept when a tokenized file is absent');
    assert.match(res.stderr + res.stdout, /tokenized file\(s\) absent \(config\/profile\.yml\); retaining/);
  });
});

test('scrub records tokenized files and restore removes map when all tokenized files are restored', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });

    // Provide config/privacy.yml
    fs.writeFileSync(
      path.join(configDir, 'privacy.yml'),
      'protected:\n  names:\n    - Jane Doe\n',
      'utf8'
    );
    const cvFile = path.join(dir, 'cv.md');
    fs.writeFileSync(cvFile, 'Candidate: Jane Doe', 'utf8');

    const privacyPath = path.join(configDir, 'privacy.yml');

    // Run scrub
    const resScrub = spawnSync(process.execPath, [scriptPath, 'scrub'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PRIVACY: privacyPath },
    });
    assert.equal(resScrub.status, 0);
    assert.equal(fs.existsSync(tokenMap), true);
    const savedMap = JSON.parse(fs.readFileSync(tokenMap, 'utf8'));
    assert.deepEqual(savedMap.__files__, ['cv.md']);

    // Run restore
    const resRestore = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PRIVACY: privacyPath },
    });
    assert.equal(resRestore.status, 0);
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Jane Doe');
    assert.equal(fs.existsSync(tokenMap), false, 'token map should be unlinked after all tokenized files restored');
  });
});

test('isTokenKey distinguishes metadata __files__ and __restored__ from tokens including double-underscore tokens', () => {
  assert.equal(isTokenKey('__files__'), false);
  assert.equal(isTokenKey('__restored__'), false);
  assert.equal(isTokenKey('__NAME__'), true);
  assert.equal(isTokenKey('__EMAIL__'), true);
  assert.equal(isTokenKey('PRIVACY_VALUE_1'), true);
  assert.equal(isTokenKey('TOKEN_A'), true);
});

test('rehydrate and restore preserve and restore legacy double-underscore tokens like __NAME__ while treating __files__ as metadata', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');

    // Token map contains legacy __NAME__ token and __files__ metadata
    fs.writeFileSync(
      tokenMap,
      JSON.stringify({
        __files__: ['cv.md'],
        __NAME__: 'Alice Smith',
        PRIVACY_VALUE_1: 'Acme Corp',
      }),
      'utf8'
    );
    fs.writeFileSync(cvFile, 'Candidate: __NAME__ at PRIVACY_VALUE_1', 'utf8');

    const res = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(res.status, 0);
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Alice Smith at Acme Corp');
    assert.equal(fs.existsSync(tokenMap), false, 'token map should be unlinked after all tokens including __NAME__ are restored');
  });
});

test('restore retains token map when legacy double-underscore token like __NAME__ is unrestored', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');

    fs.writeFileSync(
      tokenMap,
      JSON.stringify({
        __files__: ['cv.md'],
        __NAME__: 'Alice Smith',
      }),
      'utf8'
    );
    fs.writeFileSync(cvFile, 'Candidate: Someone Else', 'utf8');

    const res = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(res.status, 0);
    assert.equal(fs.existsSync(tokenMap), true, 'token map must be kept when __NAME__ is not restored');
    assert.match(res.stderr + res.stdout, /1 token map entry\(ies\) not restored; retaining/);
  });
});

test('restore preserves completed progress across retries when a later file write fails', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');
    const profileDir = path.join(dir, 'config');
    fs.mkdirSync(profileDir, { recursive: true });
    const profileFile = path.join(profileDir, 'profile.yml');

    fs.writeFileSync(cvFile, 'Candidate: PRIVACY_VALUE_1', 'utf8');
    fs.writeFileSync(profileFile, 'name: PRIVACY_VALUE_2', 'utf8');

    fs.writeFileSync(
      tokenMap,
      JSON.stringify({
        __files__: ['cv.md', 'config/profile.yml'],
        PRIVACY_VALUE_1: 'Alice Smith',
        PRIVACY_VALUE_2: 'Secret Name',
      }),
      'utf8'
    );

    // Targeted EACCES injection in child process for writes to profile.yml
    const scriptUrl = pathToFileURL(scriptPath).href;
    const preload = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const origAccess = fs.accessSync;
      fs.accessSync = function accessSync(p, ...args) {
        if (typeof p === 'string' && p.includes('profile.yml')) {
          const err = new Error('EACCES: permission denied');
          err.code = 'EACCES';
          throw err;
        }
        return origAccess.call(this, p, ...args);
      };
      syncBuiltinESMExports();
      process.argv = [process.argv[0], ${JSON.stringify(scriptPath)}, 'restore'];
      await import(${JSON.stringify(scriptUrl)});
    `;

    const resFail = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', preload],
      {
        encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_ROOT: dir },
      }
    );

    // First attempt failed on profile.yml
    assert.equal(resFail.status, 1);
    // cv.md was already restored
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Alice Smith');
    // Token map is preserved with both mappings retained
    assert.equal(fs.existsSync(tokenMap), true);
    const midMap = JSON.parse(fs.readFileSync(tokenMap, 'utf8'));
    assert.equal(midMap.PRIVACY_VALUE_1, 'Alice Smith');
    assert.equal(midMap.PRIVACY_VALUE_2, 'Secret Name');

    // Second attempt (retry) without the failure hook
    const resRetry = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });

    assert.equal(resRetry.status, 0);
    assert.equal(fs.readFileSync(profileFile, 'utf8'), 'name: Secret Name');
    // Token map is cleanly removed after retry finishes restoring remaining file
    assert.equal(fs.existsSync(tokenMap), false);
  });
});

test('scrub removes re-scrubbed tokens from map.__restored__ before saving map', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');
    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const privacyPath = path.join(configDir, 'privacy.yml');

    fs.writeFileSync(
      privacyPath,
      'protected:\n  names:\n    - Jane Doe\n',
      'utf8'
    );
    // cv.md has real value
    fs.writeFileSync(cvFile, 'Candidate: Jane Doe', 'utf8');

    // Token map claims PRIVACY_VALUE_1 was restored
    fs.writeFileSync(
      tokenMap,
      JSON.stringify({
        __files__: ['cv.md'],
        __restored__: ['PRIVACY_VALUE_1', 'OTHER_TOKEN'],
        PRIVACY_VALUE_1: 'Jane Doe',
      }),
      'utf8'
    );

    // Run scrub
    const resScrub = spawnSync(process.execPath, [scriptPath, 'scrub'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PRIVACY: privacyPath },
    });
    assert.equal(resScrub.status, 0);

    const savedMap = JSON.parse(fs.readFileSync(tokenMap, 'utf8'));
    // PRIVACY_VALUE_1 was written back into cv.md, so it must be removed from __restored__
    assert.deepEqual(savedMap.__restored__, ['OTHER_TOKEN']);
  });
});

test('scrub reserves IDs already used by markers in text so new tokens do not collide', () => {
  const mockGuard = { textValues: new Set(['Jane Smith']) };
  const map = {};
  // text already contains unmapped marker PRIVACY_VALUE_1
  const text = 'Existing note: PRIVACY_VALUE_1; Candidate: Jane Smith';
  const scrubbed = scrub(text, mockGuard, map);

  // Jane Smith must NOT receive PRIVACY_VALUE_1; it must receive PRIVACY_VALUE_2
  assert.equal(scrubbed, 'Existing note: PRIVACY_VALUE_1; Candidate: PRIVACY_VALUE_2');
  assert.equal(map['PRIVACY_VALUE_1'], undefined);
  assert.equal(map['PRIVACY_VALUE_2'], 'Jane Smith');

  // On restore, unmapped PRIVACY_VALUE_1 is preserved as-is
  const restored = rehydrate(scrubbed, map);
  assert.equal(restored, text);
});

test('scrubbing PRIVACY_VALUE_10 does not invalidate progress for PRIVACY_VALUE_1 in map.__restored__', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');
    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const privacyPath = path.join(configDir, 'privacy.yml');

    fs.writeFileSync(
      privacyPath,
      'protected:\n  names:\n    - Target Company\n',
      'utf8'
    );
    fs.writeFileSync(cvFile, 'Works at: Target Company', 'utf8');

    // Token map already has 9 tokens, so next token allocated is PRIVACY_VALUE_10
    const existingTokens = {};
    for (let i = 1; i <= 9; i++) {
      existingTokens[`PRIVACY_VALUE_${i}`] = `Value_${i}`;
    }

    fs.writeFileSync(
      tokenMap,
      JSON.stringify({
        __files__: ['cv.md'],
        __restored__: ['PRIVACY_VALUE_1'],
        ...existingTokens,
      }),
      'utf8'
    );

    const resScrub = spawnSync(process.execPath, [scriptPath, 'scrub'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PRIVACY: privacyPath },
    });
    assert.equal(resScrub.status, 0);

    const savedMap = JSON.parse(fs.readFileSync(tokenMap, 'utf8'));
    // Target Company received PRIVACY_VALUE_10
    assert.equal(savedMap['PRIVACY_VALUE_10'], 'Target Company');
    // PRIVACY_VALUE_1 must remain in __restored__
    assert.deepEqual(savedMap.__restored__, ['PRIVACY_VALUE_1']);
  });
});

test('status detects legacy tokens in map present in user files', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');

    // Token map contains legacy token __NAME__
    fs.writeFileSync(
      tokenMap,
      JSON.stringify({
        __NAME__: 'Alice Smith',
      }),
      'utf8'
    );
    fs.writeFileSync(cvFile, 'Candidate: __NAME__', 'utf8');

    const res = spawnSync(process.execPath, [scriptPath, 'status'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /cv\.md: contains tokens/);
  });
});

test('scrub throws RangeError when allocating a token index that is not a safe integer', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');
    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const privacyPath = path.join(configDir, 'privacy.yml');

    fs.writeFileSync(
      privacyPath,
      'protected:\n  names:\n    - Alice Smith\n',
      'utf8'
    );
    // Token map already holds MAX_SAFE_INTEGER so next index cannot be safely incremented
    fs.writeFileSync(
      tokenMap,
      JSON.stringify({
        [`PRIVACY_VALUE_${Number.MAX_SAFE_INTEGER}`]: 'Existing Value',
      }),
      'utf8'
    );
    fs.writeFileSync(cvFile, 'Candidate: Alice Smith', 'utf8');

    const res = spawnSync(process.execPath, [scriptPath, 'scrub'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Cannot allocate token ID.*exceeds Number\.MAX_SAFE_INTEGER/);
  });
});




