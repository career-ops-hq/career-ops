// bind-host.mjs — what interface the dashboard listens on, and the argv that says so.
//
// The socket is the dashboard's access control. `next dev` / `next start` with
// no -H reach server.listen(port, undefined), which binds every interface, and
// the request guard cannot compensate: Host is chosen by the client, so a LAN
// caller spelling `Host: localhost` satisfies it. See origin-guard.mjs's header
// for the full threat model — this module owns only the bind half of it.
//
// Kept out of origin-guard.mjs, which is per-request decision logic pinned to
// the edge runtime. Both read CAREER_OPS_WEB_ALLOWED_HOSTS through the same
// parseAllowedHosts, so neither can widen on that variable without the other.
//
// That is the limit of the guarantee, and the two layers do diverge elsewhere:
// a caller's -H moves the bind with the allow-list untouched, and 0.0.0.0 is
// IPv4-only, so an opted-in IPv6 host passes the filter with nothing listening
// for it. planNextRun reports the first; the README documents both.
//
// Pure: no node imports, no process state. server.mjs passes the environment in
// and acts on what comes back, so the whole decision is testable on values
// rather than inferred from the launcher's source text.

import { parseAllowedHosts, isLoopbackHost } from "./origin-guard.mjs";

export const LOOPBACK_BIND = "127.0.0.1";
export const ALL_INTERFACES_BIND = "0.0.0.0";

/** The `next` subcommands this launcher fronts. */
export const NEXT_COMMANDS = Object.freeze(["dev", "start"]);

/** Spellings of next's hostname option, in both `-H x` and `--hostname=x` forms. */
const HOST_FLAGS = Object.freeze(["-H", "--hostname"]);

/**
 * Which interface to listen on, given the opt-in.
 *
 * Widens only for a host that loopback cannot already serve. Naming a loopback
 * host (`localhost`, `127.0.0.1`, `::1`) is not an opt-in to anything: the Host
 * filter admits loopback unconditionally, so widening for it would open every
 * interface while granting no host that was not already allowed — full LAN
 * exposure from a value a user could reasonably read as a no-op, or even as a
 * tightening.
 *
 * @param {string|undefined} envValue  CAREER_OPS_WEB_ALLOWED_HOSTS
 * @returns {"0.0.0.0"|"127.0.0.1"}
 */
export function resolveBindHost(envValue) {
  for (const host of parseAllowedHosts(envValue)) {
    if (!isLoopbackHost(host)) return ALL_INTERFACES_BIND;
  }
  return LOOPBACK_BIND;
}

/**
 * Is this bind reachable from outside the machine?
 *
 * Asked of the host itself rather than compared against LOOPBACK_BIND, so a
 * future third value (`::1`, a specific interface) cannot silently invert the
 * warning that depends on it.
 *
 * @param {string} bindHost
 * @returns {boolean}
 */
export function isWidenedBind(bindHost) {
  return !isLoopbackHost(bindHost);
}

/**
 * The last hostname a caller supplied in forwarded argv, if any.
 *
 * next parses with commander, where a repeated option keeps the LAST value — so
 * this, not the resolved bind, is what the server will actually listen on.
 *
 * @param {string[]} extra
 * @returns {string|null}
 */
function overriddenHost(extra) {
  let found = null;
  for (let i = 0; i < extra.length; i++) {
    const token = String(extra[i]);

    // Commander's attached short form, `-H0.0.0.0`. Missing it is not a silent
    // no-op: next honours the flag and binds every interface while the startup
    // notice, computed from the resolved bind, announces loopback. `--hostname`
    // starts with `--`, so it cannot be caught here by accident.
    if (token.startsWith("-H") && token.length > 2) {
      found = token.slice(2);
      continue;
    }

    const [name, attached] = token.split(/=(.*)/s);
    if (!HOST_FLAGS.includes(name)) continue;
    // A separated value is only a value if it is not the next flag: `-H -p 4000`
    // would otherwise be reported as "binding -p".
    const separated = extra[i + 1] !== undefined && !String(extra[i + 1]).startsWith("-")
      ? extra[i + 1]
      : undefined;
    const value = attached !== undefined ? attached : separated;
    if (value !== undefined) found = value;
  }
  return found;
}

/**
 * The argv for a `next` run, plus what it will actually expose.
 *
 * `-H` is forwarded rather than refused: it is a flag someone typed
 * deliberately, and Next accepts it. But because commander keeps the last value,
 * a caller-supplied `-H` overrides the resolved bind — and if it widens while
 * CAREER_OPS_WEB_ALLOWED_HOSTS is empty, the result is an open port whose filter
 * names nobody: honest LAN clients get 403, a client spoofing `Host: localhost`
 * gets through. That combination cannot be prevented without refusing the flag,
 * so it is reported instead. `widened` is therefore computed from the EFFECTIVE
 * host, never from the env value, so the warning can never go quiet while the
 * socket is open.
 *
 * @param {object} input
 * @param {string|undefined} input.command   argv[2] — a NEXT_COMMANDS entry
 * @param {string[]} [input.extra]           remaining argv, forwarded verbatim
 * @param {string|undefined} input.envValue  CAREER_OPS_WEB_ALLOWED_HOSTS
 * @returns {{ok: true, argv: string[], bindHost: string, effectiveBindHost: string,
 *            widened: boolean, overridden: boolean, allowedHosts: string[]}
 *          | {ok: false, error: string}}
 */
export function planNextRun({ command, extra = [], envValue }) {
  if (!NEXT_COMMANDS.includes(command)) {
    return {
      ok: false,
      error:
        `Usage: node server.mjs <${NEXT_COMMANDS.join("|")}> [next options]\n` +
        "Run it through npm: `npm run dev` / `npm start` (extra flags after --).",
    };
  }

  const bindHost = resolveBindHost(envValue);
  const override = overriddenHost(extra);
  // An empty value is not "no override": Node binds every interface for
  // listen(port, "") exactly as it does for undefined, so `-H ""` widens the
  // socket. Naming it here keeps the notice readable and, more importantly,
  // keeps it truthful — reporting the empty string as the bind would be
  // accurate and useless, and treating it as absent would hide a real exposure.
  const effectiveBindHost =
    override === null ? bindHost : override.trim() === "" ? ALL_INTERFACES_BIND : override;

  const allowedHosts = [...parseAllowedHosts(envValue)];
  return {
    ok: true,
    argv: [command, "-H", bindHost, ...extra],
    bindHost,
    effectiveBindHost,
    widened: isWidenedBind(effectiveBindHost),
    overridden: override !== null,
    allowedHosts,
    // Whether the filter names anyone loopback could not already serve. An open
    // socket in this state has no honest reading: it refuses LAN clients that
    // identify themselves truthfully and admits any that spell `Host: localhost`.
    // Asked of the hosts rather than of the list's length, because
    // CAREER_OPS_WEB_ALLOWED_HOSTS=localhost is a non-empty list that grants
    // exactly nothing — the case that used to slip through silently.
    grantsNoNewHost: !allowedHosts.some((host) => !isLoopbackHost(host)),
  };
}
