import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export class EngineError extends Error {
  constructor(code) { super(code); this.name = 'EngineError'; this.code = code; }
}

// Internal trusted worker primitive, never a public command-execution API.
export function runProcess({ script, args = [], cwd, env, signal, timeoutMs = 120_000, maxBytes = 2_000_000 }) {
  if (signal?.aborted) return Promise.reject(new EngineError('cancelled'));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(process.execPath, [script, ...args], {
        cwd, env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch { reject(new EngineError('spawn_failed')); return; }
    let stdout = '', stderr = '', bytes = 0, stopped = null;
    const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
    const stop = (reason) => {
      if (stopped) return;
      stopped = reason;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        // Absolute OS binary; arguments are separate, never shell-interpreted.
        execFile(path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => { child.kill('SIGKILL'); });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    };
    const abort = () => stop('cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('timed_out'), timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const collect = (name, data) => {
      bytes += data.length;
      if (bytes > maxBytes) { stop('output_limit'); return; }
      if (name === 'stdout') stdout += outDecoder.write(data); else stderr += errDecoder.write(data);
    };
    child.stdout.on('data', d => collect('stdout', d));
    child.stderr.on('data', d => collect('stderr', d));
    child.on('error', () => { cleanup(); reject(new EngineError('spawn_failed')); });
    child.on('close', code => {
      cleanup();
      stdout += outDecoder.end(); stderr += errDecoder.end();
      // Do not return raw model output, paths, provider errors or credentials in errors.
      if (stopped) reject(new EngineError(stopped));
      else if (code !== 0) reject(new EngineError('engine_failed'));
      else resolve({ stdout, stderr });
    });
    if (signal?.aborted) abort();
  });
}
