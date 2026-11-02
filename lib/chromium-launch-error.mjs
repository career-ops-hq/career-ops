// lib/chromium-launch-error.mjs — what a failed chromium.launch() says went wrong.
//
// doctor validates Chromium by launching it. It used to discard the launch
// error and report every failure as "not installed → npx playwright install
// chromium". That is right for one cause only: the binary is absent. When the
// binary is there but cannot start (a slim Linux image without the system
// libraries Chromium links against, a sandbox or container that blocks the
// process, a launch timeout), the install command finds the browser already
// downloaded and does nothing, and the user is sent back to rerun it.
//
// This reads the message Playwright throws, so doctor can name the cause and
// prescribe only what fixes it. Pure string work: no Playwright import, so it
// is testable without a browser.

const LAUNCH_PREFIX = /^browserType\.launch:\s*/;
// Linux shared objects (libnss3.so, libgbm.so.1) and Windows DLLs, as Playwright
// lists them in its host-dependency box and as the dynamic loader names them.
const SHARED_LIB = /\b[\w+-]+(?:\.[\w+-]+)*\.(?:so(?:\.\d+)*|dll)\b/gi;
const MAX_DETAIL = 200;

function truncate(s) {
  return s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s;
}

// The browser's own stderr, as Playwright echoes it under "Browser logs:" as
// `[pid=N][err] ...`. It is the line that says why the process died; the rest
// of the message is the launch command line and Playwright's call log.
function firstBrowserStderrLine(message) {
  for (const line of message.split('\n')) {
    const m = line.match(/^\s*(?:-\s*)?\[pid=\d+\]\[err\]\s*(.*\S)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Classify the error chromium.launch() threw.
 *
 * @param {unknown} err - The thrown value (an Error, or anything else).
 * @returns {{ kind: 'missing-executable', path: string|null }
 *   | { kind: 'missing-libraries', libraries: string[] }
 *   | { kind: 'launch-failed', detail: string }}
 */
export function classifyChromiumLaunchError(err) {
  const message = String(err?.message ?? err ?? '');

  const exe = message.match(/Executable doesn't exist at (\S+)/);
  if (exe) return { kind: 'missing-executable', path: exe[1] };

  // Linux says "...missing dependencies to run browsers.", Windows says
  // "...missing dependencies!" and lists DLLs.
  const hostDeps = /Host system is missing dependencies/.test(message);
  const loaderLine = message.split('\n').find((line) => /error while loading shared libraries/.test(line));
  if (hostDeps || loaderLine) {
    // The loader line names one library; the host-dependency box lists them all.
    // Neither the launch command line nor the browser path holds a .so name, so
    // only those two sources are scanned.
    const source = hostDeps ? message.slice(message.indexOf('Host system is missing')) : loaderLine;
    const libraries = [...new Set(source.match(SHARED_LIB) || [])];
    return { kind: 'missing-libraries', libraries };
  }

  const stderr = firstBrowserStderrLine(message);
  const firstLine = message.replace(LAUNCH_PREFIX, '').split('\n').find((line) => line.trim()) || 'unknown error';
  return { kind: 'launch-failed', detail: truncate((stderr || firstLine).trim()) };
}
