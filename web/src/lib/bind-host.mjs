// bind-host.mjs — what interface the dashboard listens on, and the argv that says so.
//
// The socket is the dashboard's outermost access control. `next dev` /
// `next start` with no -H reach server.listen(port, undefined), which binds every
// interface, and the request guard cannot compensate: Host is chosen by the
// client, so a LAN caller spelling `Host: localhost` satisfies it. See
// origin-guard.mjs's header for the full threat model — this module owns only the
// bind half of it, and the bind is not the whole of it.
//
// Kept out of origin-guard.mjs, which is per-request decision logic pinned to
// the edge runtime. Both read CAREER_OPS_WEB_ALLOWED_HOSTS through the same
// parseAllowedHosts, so neither can widen on that variable without the other.
//
// That is the limit of the guarantee, and the two layers do diverge elsewhere:
// a caller's own -H moves the bind with the allow-list untouched, and a fallback
// bind of 0.0.0.0 is IPv4-only, so an opted-in IPv6 host passes the filter with
// nothing listening for it. planNextRun reports the first; the README documents
// both.
//
// Pure in the sense that matters: no process state, no I/O. server.mjs passes
// the environment in and acts on what comes back, so the whole decision is
// testable on values rather than inferred from the launcher's source text.
//
// It does import node:net for isIP. Only server.mjs and the tests import this
// module — proxy.ts imports origin-guard.mjs, which stays free of node imports
// for the edge runtime — so the dependency costs nothing here, and hand-rolling
// an address parser instead proved to be exactly the wrong trade: the version
// that counted colons admitted `2001:db8:1` as a bind target.

import { isIP } from "node:net";
import { parseAllowedHosts, isLoopbackHost } from "./origin-guard.mjs";

export const LOOPBACK_BIND = "127.0.0.1";
export const ALL_INTERFACES_BIND = "0.0.0.0";

/** The `next` subcommands this launcher fronts. */
export const NEXT_COMMANDS = Object.freeze(["dev", "start"]);

// Values a user reaches for after reading the variable's name as a switch.
// Every one of them is a syntactically valid hostname, so only an explicit list
// catches them — and each would otherwise be a non-loopback host, i.e. an opt-in
// to full network exposure typed by someone trying to turn exposure OFF.
const SWITCH_LIKE = Object.freeze(
  new Set(["on", "off", "true", "false", "yes", "no", "0", "1", "none", "all", "enable", "enabled", "disable", "disabled"]),
);

// A URL written where a host belongs. Host-header normalization cuts at the
// first colon, so `http://192.168.1.50` arrives here as the bare name `http` —
// a valid hostname, and a non-loopback one, so it too would have opened the
// socket while looking like it named an address.
const URL_SCHEMES = Object.freeze(new Set(["http", "https"]));

const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * An IPv4 or IPv6 literal, already unbracketed by parseAllowedHosts.
 *
 * Node's own parser rather than a hand-rolled one. The first version here
 * counted colons and hex digits, which accepted incomplete addresses like
 * `2001:db8:1` — enough to be treated as a bindable literal and handed to
 * `next -H`, where listen() then refused to start the server. Being lenient here
 * cannot fail safe, because whatever this admits becomes a bind target.
 *
 * isIP also rejects the leading-zero form `010.0.0.1`, which some resolvers read
 * as octal and others as decimal — a poor thing to bind or to compare an
 * allow-list against.
 *
 * @param {string} host
 * @returns {boolean}
 */
function isIPLiteral(host) {
  return isIP(host) !== 0;
}

/**
 * Is this address "every interface" rather than one of them?
 *
 * Covers `0.0.0.0` and every spelling of the IPv6 wildcard (`::`, `0::0`,
 * `0:0:0:0:0:0:0:0`). Both are bind targets, never identities a client can be
 * addressed by, so they mean something different in a bind than in a host list.
 *
 * Exported because it guards two unrelated decisions — refusing a wildcard in
 * the allow-list, and refusing to claim loopback is lost on a wildcard bind —
 * and validation makes the second unreachable through planNextRun. Tested
 * directly so that guard stays falsifiable rather than becoming decoration.
 *
 * @param {string} host
 * @returns {boolean}
 */
export function isWildcardAddress(host) {
  return host === ALL_INTERFACES_BIND || (host.includes(":") && /^[0:]+$/.test(host));
}

/**
 * An IPv6 link-local address (fe80::/10) with no zone index.
 *
 * A link-local address is ambiguous across interfaces, so binding one requires
 * a zone (`fe80::1%en0`) — without it listen() fails. The scoped spelling is
 * refused earlier as a hostname, since `%` is not a host character, so this
 * only has to catch the bare form.
 *
 * @param {string} host
 * @returns {boolean}
 */
function isUnscopedLinkLocalV6(host) {
  return /^fe[89ab][0-9a-f]:/.test(host);
}

/**
 * Is this a host someone could plausibly have meant?
 *
 * @param {string} host  a single entry, already lowercased and port-stripped
 * @returns {boolean}
 */
function isPlausibleHost(host) {
  if (isIPLiteral(host)) return true;
  if (host.length > 253) return false;
  const labels = host.replace(/\.$/, "").split("."); // a trailing root dot is a valid FQDN
  if (!labels.every((label) => label.length <= 63 && HOSTNAME_LABEL.test(label))) return false;
  // Having already failed isIPLiteral, an all-numeric final label means a
  // malformed address — `10.0.0.999` — rather than a name anything could
  // resolve (RFC 1123 §2.1 forbids a wholly numeric top-level label).
  return !/^\d+$/.test(labels[labels.length - 1]);
}

/**
 * The opted-in hosts, or a refusal naming what could not be read as a host.
 *
 * Fails fast rather than widening on nonsense: every value this rejects would
 * otherwise have counted as a non-loopback host and opened the socket to the
 * whole network, which is the opposite of what someone typing `off` intends.
 *
 * @param {string|undefined} envValue  CAREER_OPS_WEB_ALLOWED_HOSTS
 * @returns {{ok: true, hosts: string[]} | {ok: false, error: string}}
 */
export function validateAllowedHosts(envValue) {
  const hosts = [...parseAllowedHosts(envValue)];
  for (const host of hosts) {
    if (SWITCH_LIKE.has(host)) {
      return {
        ok: false,
        error:
          `CAREER_OPS_WEB_ALLOWED_HOSTS="${host}" is not a switch — it is the list of hosts allowed to\n` +
          "reach the dashboard, and any name in it opens the socket beyond this machine.\n" +
          "Unset the variable to stay on loopback, or name the hosts that should reach it.",
      };
    }
    if (isWildcardAddress(host)) {
      return {
        ok: false,
        error:
          `CAREER_OPS_WEB_ALLOWED_HOSTS="${host}" names every interface, which is a bind target and\n` +
          "not a host any client is addressed by. Accepting it opens the socket while the request\n" +
          "guard still matches Host literally, so honest clients on your network get 403 and only a\n" +
          `client that spells "Host: ${host}" is let in.\n` +
          'Name the hosts that should reach it, e.g. CAREER_OPS_WEB_ALLOWED_HOSTS="192.168.1.50".',
      };
    }
    if (isUnscopedLinkLocalV6(host)) {
      return {
        ok: false,
        error:
          `CAREER_OPS_WEB_ALLOWED_HOSTS contains the link-local address "${host}", which is ambiguous\n` +
          "across interfaces and cannot be bound without a zone index. Use a routable address or a\n" +
          "hostname instead.",
      };
    }
    if (URL_SCHEMES.has(host)) {
      return {
        ok: false,
        error:
          "CAREER_OPS_WEB_ALLOWED_HOSTS takes hosts, not URLs — a scheme is cut off at the colon,\n" +
          "leaving the name of the scheme itself as the allowed host.\n" +
          'Write the host alone, e.g. CAREER_OPS_WEB_ALLOWED_HOSTS="192.168.1.50".',
      };
    }
    if (!isPlausibleHost(host)) {
      return {
        ok: false,
        error:
          `CAREER_OPS_WEB_ALLOWED_HOSTS contains "${host}", which is not a hostname or IP address.\n` +
          "Separate entries with commas or spaces, e.g. CAREER_OPS_WEB_ALLOWED_HOSTS=\"192.168.1.50, nas.local\".",
      };
    }
  }
  return { ok: true, hosts };
}

/**
 * Which interface to listen on, given the opt-in.
 *
 * Three outcomes, narrowest first:
 *
 *   - Loopback, when nothing is named that loopback cannot already serve. Naming
 *     a loopback host (`localhost`, `127.0.0.1`, `::1`) is not an opt-in to
 *     anything: the Host filter admits loopback unconditionally, so widening for
 *     it would open every interface while granting no host that was not already
 *     allowed — full network exposure from a value a user could reasonably read
 *     as a no-op, or even as a tightening.
 *   - That address alone, when exactly one host is named and it is an IP
 *     literal. Binding 0.0.0.0 for it would also publish the dashboard on every
 *     other interface the machine happens to have — a VPN tunnel, a phone
 *     hotspot — none of which was asked for. The cost is that loopback stops
 *     answering, since one socket carries one address; naming a loopback host
 *     alongside it is how a caller asks for both and accepts 0.0.0.0.
 *   - 0.0.0.0, otherwise: a hostname needs a resolver this module deliberately
 *     does not have, and two addresses cannot share one socket.
 *
 * Assumes validateAllowedHosts has already accepted the value.
 *
 * @param {string|undefined} envValue  CAREER_OPS_WEB_ALLOWED_HOSTS
 * @returns {string}
 */
export function resolveBindHost(envValue) {
  const named = [...parseAllowedHosts(envValue)];
  const reachable = named.filter((host) => !isLoopbackHost(host));
  if (reachable.length === 0) return LOOPBACK_BIND;
  const loopbackAlsoNamed = reachable.length !== named.length;
  if (!loopbackAlsoNamed && reachable.length === 1 && isIPLiteral(reachable[0])) return reachable[0];
  return ALL_INTERFACES_BIND;
}

/**
 * Is this bind reachable from outside the machine?
 *
 * Asked of the host itself rather than compared against LOOPBACK_BIND, so the
 * specific-address and all-interfaces binds above cannot silently invert the
 * warning that depends on it.
 *
 * @param {string} bindHost
 * @returns {boolean}
 */
export function isWidenedBind(bindHost) {
  return !isLoopbackHost(bindHost);
}

/**
 * Did the caller supply next's hostname flag themselves?
 *
 * Presence only — not the value. next parses with commander, and reproducing its
 * resolution here (attached `-H0.0.0.0`, `--hostname=`, last-of-repeated) is a
 * standing bet against a dependency, one this launcher has already lost once:
 * a missed spelling made it announce loopback while every interface was open.
 * Knowing only that the flag is there is enough to hand the decision back to
 * next and say so, and it cannot drift as next's parser changes.
 *
 * Erring towards a false positive is safe — the launcher forwards argv untouched
 * and warns — so the short form is matched on its prefix, which has no false
 * negative. No other `next dev` / `next start` option begins with `-H`.
 *
 * @param {string[]} extra
 * @returns {boolean}
 */
export function hasHostFlag(extra) {
  return extra.some((token) => {
    const flag = String(token);
    return flag.startsWith("-H") || flag === "--hostname" || flag.startsWith("--hostname=");
  });
}

/**
 * The argv for a `next` run, plus what it will actually expose.
 *
 * The bind is injected only when the caller supplied no hostname flag of their
 * own. `-H` is theirs to pass — they typed it deliberately and next accepts it —
 * so rather than appending a second one and relying on how commander resolves the
 * duplicate, the launcher stands aside and reports that next now owns the
 * decision. The run may well be network-reachable; nothing here can say it is
 * loopback, so nothing here does.
 *
 * @param {object} input
 * @param {string|undefined} input.command   argv[2] — a NEXT_COMMANDS entry
 * @param {string[]} [input.extra]           remaining argv, forwarded verbatim
 * @param {string|undefined} input.envValue  CAREER_OPS_WEB_ALLOWED_HOSTS
 * @returns {{ok: true, argv: string[], bindHost: string, hostFlagSupplied: boolean,
 *            widened: boolean, allowedHosts: string[], grantsNoNewHost: boolean,
 *            loopbackUnreachable: boolean}
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

  const validation = validateAllowedHosts(envValue);
  if (!validation.ok) return validation;

  const { hosts: allowedHosts } = validation;
  const bindHost = resolveBindHost(envValue);
  const hostFlagSupplied = hasHostFlag(extra);
  const widened = isWidenedBind(bindHost);

  return {
    ok: true,
    argv: hostFlagSupplied ? [command, ...extra] : [command, "-H", bindHost, ...extra],
    bindHost,
    hostFlagSupplied,
    // Describes the resolved bind, which is what next listens on unless the
    // caller supplied their own flag — hence read together with hostFlagSupplied,
    // never on its own.
    widened,
    allowedHosts,
    // Whether the filter names anyone loopback could not already serve. An open
    // socket in this state has no honest reading: it refuses LAN clients that
    // identify themselves truthfully and admits any that spell `Host: localhost`.
    // Only reachable via a caller's own -H — the env var cannot widen the bind
    // without naming such a host — and asked of the hosts rather than of the
    // list's length, because CAREER_OPS_WEB_ALLOWED_HOSTS=localhost is a
    // non-empty list that grants exactly nothing.
    grantsNoNewHost: !allowedHosts.some((host) => !isLoopbackHost(host)),
    // A single named address carries the whole socket, so http://localhost:PORT
    // stops answering. Worth saying out loud: the symptom otherwise looks like a
    // server that failed to start.
    // Asked of the address rather than compared against the 0.0.0.0 literal: the
    // IPv6 wildcard is also every interface, loopback included, so comparing to
    // one spelling would have the launcher announce that localhost stops
    // answering while it answers fine — a false claim about its own bind, which
    // is the failure this module exists to prevent.
    loopbackUnreachable: !hostFlagSupplied && widened && !isWildcardAddress(bindHost),
  };
}
