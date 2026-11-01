#!/usr/bin/env node
// build-dashboard.mjs — cross-platform build for the Go TUI dashboard.
//
// `go build -o career-dashboard .` writes an extension-less binary on Windows
// (Go only auto-appends .exe when -o is omitted), which breaks bare-name/PATH
// lookup there. This wrapper picks the platform-correct output name instead:
// dashboard/career-dashboard on Unix, dashboard/career-dashboard.exe on Windows.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = process.platform === 'win32' ? 'career-dashboard.exe' : 'career-dashboard';

// The minimum Go is go.mod's `go` line, read here so this message can't fall
// behind it again (it said 1.24+ while go.mod required 1.26.0).
function goFloor() {
  try {
    return readFileSync(join(root, 'dashboard', 'go.mod'), 'utf8').match(/^go\s+(\d+\.\d+)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

const result = spawnSync('go', ['build', '-o', out, '.'], {
  cwd: join(root, 'dashboard'),
  stdio: 'inherit',
});

if (result.error) {
  if (result.error.code === 'ENOENT') {
    const floor = goFloor();
    console.error(`Go toolchain not found. Install Go ${floor ? `${floor}+ ` : ''}from https://go.dev/dl/ and retry.`);
  } else {
    console.error(`Build failed to start: ${result.error.message}`);
  }
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Built dashboard/${out} — run it with: npm run serve:dashboard (or dashboard/${out} --path .)`);
