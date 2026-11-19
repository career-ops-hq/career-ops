// Operator setup tool, never called by a job. Derive the runtime policy from
// Playwright's version-pinned default-Docker profile; reject source drift.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isMainModule } from '../lib/is-main-module.mjs';

const SOURCE = 'https://raw.githubusercontent.com/microsoft/playwright/v1.65.0/utils/docker/seccomp_profile.json';
const SOURCE_SHA256 = 'cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849';

export async function prepareSeccomp(destination) {
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Could not download the pinned Playwright seccomp profile');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== SOURCE_SHA256) throw new Error('Playwright seccomp source hash changed; review before updating');
  const profile = JSON.parse(bytes.toString('utf8'));
  const namespaces = profile.syscalls.find(entry => entry.comment === 'Allow create user namespaces');
  if (profile.defaultAction !== 'SCMP_ACT_ERRNO' || !namespaces || namespaces.action !== 'SCMP_ACT_ALLOW') throw new Error('Unexpected seccomp source shape');
  // With all initial capabilities dropped, Docker's conditional chroot rule is
  // absent. Chromium needs the syscall after it creates its own user namespace.
  // Kernel capability checks still prevent host-namespace privileged chroot.
  namespaces.names.push('chroot');
  namespaces.comment = 'Allow Chromium namespace sandbox creation and its namespaced chroot';
  await fs.writeFile(destination, `${JSON.stringify(profile, null, 2)}\n`, { flag: 'wx' });
  return { path: path.resolve(destination), source: SOURCE, sourceSha256: SOURCE_SHA256 };
}

if (isMainModule(import.meta.url)) {
  const target = process.argv[2] || fileURLToPath(new URL('./seccomp.generated.json', import.meta.url));
  try { console.log(JSON.stringify(await prepareSeccomp(target))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
