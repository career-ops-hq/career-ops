// tests/go-floor.test.mjs
//
// dashboard/go.mod's `go` line is the toolchain floor. A Go older than it does
// not fail cleanly: with GOTOOLCHAIN=auto it downloads a newer toolchain, which
// breaks offline/proxied builds (#4887 — the Dockerfile sat at 1.23.4 while
// go.mod required 1.26.0). Every place that pins a Go version must satisfy the
// floor, so a go.mod bump fails here instead of inside the container.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\n🔎 Go floor (Dockerfile and workflow pins satisfy dashboard/go.mod)');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

// Compare only to the pin's own precision: setup-go's '1.26' resolves to the
// latest 1.26.x, so it satisfies a 1.26.1 floor.
function atLeast(v, min) {
  const a = v.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < a.length; i++) if (a[i] !== (b[i] ?? 0)) return a[i] > (b[i] ?? 0);
  return true;
}

// ── The comparison ───────────────────────────────────────────────────
for (const [v, min, want] of [
  ['1.23.4', '1.26.0', false],
  ['1.26.0', '1.26.1', false],
  ['1.9', '1.10', false],
  ['1.26', '1.26.0', true],
  ['1.26', '1.26.1', true],
  ['1.27', '1.26.9', true],
  ['1.27.2', '1.26', true],
]) {
  if (atLeast(v, min) === want) pass(`${v} ${want ? 'satisfies' : 'is below'} a ${min} floor`);
  else fail(`${v} vs ${min} floor: expected ${want ? 'satisfies' : 'is below'}`);
}

// ── The pins ─────────────────────────────────────────────────────────
const floor = read('dashboard/go.mod').match(/^go\s+(\d+(?:\.\d+){1,2})\s*$/m)?.[1];
if (!floor) {
  fail('dashboard/go.mod missing a "go X.Y[.Z]" directive — cannot check Go version pins against it');
} else {
  const pins = [];
  const dockerGo = read('Dockerfile').match(/^ARG GO_VERSION=([\d.]+)\s*$/m)?.[1];
  if (dockerGo) pins.push(['Dockerfile ARG GO_VERSION', dockerGo]);
  else fail('Dockerfile missing the expected "ARG GO_VERSION=X.Y.Z" line');
  for (const wf of readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    for (const m of read(`.github/workflows/${wf}`).matchAll(/^\s*go-version:\s*['"]?([\d.]+)['"]?/gm)) {
      pins.push([`.github/workflows/${wf} go-version`, m[1]]);
    }
  }
  for (const [where, v] of pins) {
    if (atLeast(v, floor)) pass(`${where} (${v}) satisfies dashboard/go.mod's go ${floor}`);
    else fail(`${where} is ${v} but dashboard/go.mod requires go ${floor} — bump it`);
  }
}
