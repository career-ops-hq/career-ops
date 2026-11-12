import { spawnSync } from 'child_process';
import { pass, fail, ROOT } from './helpers.mjs';

const IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-jammy';

console.log('\nDocker root Git ownership');

const daemon = spawnSync('docker', ['info'], { encoding: 'utf-8', stdio: 'ignore' });
if (daemon.error || daemon.status !== 0) {
  console.log('⏭️ Docker daemon unavailable; skipping container ownership reproduction');
} else {
  const image = spawnSync('docker', ['image', 'inspect', IMAGE], { encoding: 'utf-8', stdio: 'ignore' });
  if (image.error || image.status !== 0) {
    console.log(`⏭️ ${IMAGE} is not present locally; skipping container ownership reproduction`);
  } else {
    const result = spawnSync('docker', [
      'run', '--rm', '--entrypoint', 'git',
      '--volume', `${ROOT}:/app`, '--workdir', '/app', IMAGE,
      'rev-parse', 'HEAD',
    ], { encoding: 'utf-8' });

    if (result.status === 0) {
      pass('Git can read the host-owned checkout from the project container');
    } else {
      fail(`Git could not read the host-owned checkout from the project container (exit ${result.status}): ${(result.stderr || '').trim()}`);
    }
  }
}
