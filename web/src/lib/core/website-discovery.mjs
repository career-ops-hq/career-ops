import { spawn } from 'node:child_process';

/** Call the core's read-only saved-website search; input travels over stdin so
 * long keyword lists do not exceed OS command-line limits.
 * @param {string} script
 * @param {string} root
 * @param {object} filters
 * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
 */
export function runWebsiteDiscovery(script, root, filters, { signal, timeoutMs = 280_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, 'search'], { cwd: root, env: process.env, signal, windowsHide: true });
    let stdout = '', stderr = '', settled = false, failure;
    const timer = setTimeout(() => stop(new Error('Website search timed out before completing.')), timeoutMs);
    function fail(error) { if (!settled) { settled = true; clearTimeout(timer); reject(error); } }
    // Wait for close before returning so callers can safely release the workspace
    // and all process handles, including Windows handles, have been closed.
    function stop(error) { failure ??= error; clearTimeout(timer); child.kill('SIGKILL'); }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 20_000_000) stop(new Error('Website search returned too much data.'));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => { if (child.pid) stop(error); else fail(error); });
    child.on('close', code => {
      if (settled) return;
      if (failure) return fail(failure);
      settled = true;
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(stdout.trim().split('\n').at(-1) || ''); }
      catch { return reject(new Error(stderr.trim() || 'Website search returned unreadable output.')); }
      if (code !== 0 || result.error) return reject(new Error(result.error || stderr.trim() || 'Website search failed.'));
      if (!Array.isArray(result.offers) || !Array.isArray(result.failures) || !Array.isArray(result.searched)) {
        return reject(new Error('Website search returned an incomplete result.'));
      }
      resolve(result);
    });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error); });
    child.stdin.end(JSON.stringify(filters));
  });
}
