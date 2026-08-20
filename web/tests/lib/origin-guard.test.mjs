import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHost,
  isLoopbackHost,
  parseAllowedHosts,
  checkRequest,
} from "../../src/lib/origin-guard.mjs";

// --- normalizeHost --------------------------------------------------------

test("normalizeHost lowercases and strips the port", () => {
  assert.equal(normalizeHost("LocalHost:3000"), "localhost");
  assert.equal(normalizeHost("127.0.0.1:8080"), "127.0.0.1");
});

test("normalizeHost unwraps a bracketed IPv6 host", () => {
  assert.equal(normalizeHost("[::1]:3000"), "::1");
  assert.equal(normalizeHost("[::1]"), "::1");
});

test("normalizeHost returns empty string for a missing host", () => {
  assert.equal(normalizeHost(""), "");
  assert.equal(normalizeHost(undefined), "");
});

// --- isLoopbackHost -------------------------------------------------------

test("isLoopbackHost accepts localhost and the loopback range", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("127.9.9.9"), true); // whole 127/8 is loopback
  assert.equal(isLoopbackHost("::1"), true);
});

test("isLoopbackHost rejects a LAN address", () => {
  assert.equal(isLoopbackHost("192.168.1.50"), false);
  assert.equal(isLoopbackHost("10.0.0.4"), false);
  assert.equal(isLoopbackHost("evil.example.com"), false);
});

// --- parseAllowedHosts ----------------------------------------------------

test("parseAllowedHosts splits on comma/whitespace, lowercases, strips ports", () => {
  const hosts = parseAllowedHosts("192.168.1.50:3000, Dev-Box.local  10.0.0.4");
  assert.equal(hosts.has("192.168.1.50"), true);
  assert.equal(hosts.has("dev-box.local"), true);
  assert.equal(hosts.has("10.0.0.4"), true);
});

test("parseAllowedHosts returns an empty set for blank/undefined", () => {
  assert.equal(parseAllowedHosts("").size, 0);
  assert.equal(parseAllowedHosts(undefined).size, 0);
});

// --- checkRequest: the app's own same-origin traffic passes ---------------

test("allows a same-origin fetch from the local app", () => {
  const d = checkRequest({
    secFetchSite: "same-origin",
    origin: "http://localhost:3000",
    host: "localhost:3000",
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, true);
});

test("allows a direct address-bar navigation (Sec-Fetch-Site: none)", () => {
  const d = checkRequest({
    secFetchSite: "none",
    origin: null,
    host: "localhost:3000",
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, true);
});

test("allows a non-browser client with no Origin and no Sec-Fetch-Site (curl)", () => {
  const d = checkRequest({
    secFetchSite: null,
    origin: null,
    host: "127.0.0.1:3000",
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, true);
});

// --- checkRequest: F1 drive-by / cross-origin CSRF is blocked -------------

test("blocks a cross-site request via Sec-Fetch-Site (drive-by)", () => {
  const d = checkRequest({
    secFetchSite: "cross-site",
    origin: "https://evil.example.com",
    host: "localhost:3000",
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, false);
  assert.equal(d.status, 403);
});

test("blocks a same-site (different subdomain) request via Sec-Fetch-Site", () => {
  const d = checkRequest({
    secFetchSite: "same-site",
    origin: "http://other.localhost:3000",
    host: "localhost:3000",
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, false);
});

test("blocks a mismatched Origin when Sec-Fetch-Site is absent (fallback)", () => {
  const d = checkRequest({
    secFetchSite: null,
    origin: "https://evil.example.com",
    host: "localhost:3000",
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, false);
  assert.equal(d.status, 403);
});

test("allows a matching Origin when Sec-Fetch-Site is absent (fallback)", () => {
  const d = checkRequest({
    secFetchSite: null,
    origin: "http://localhost:3000",
    host: "localhost:3000",
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, true);
});

test("blocks an opaque 'null' Origin", () => {
  const d = checkRequest({
    secFetchSite: null,
    origin: "null",
    host: "localhost:3000",
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, false);
});

// --- checkRequest: F2 LAN reachability is blocked unless opted in ---------

test("blocks a request reaching the server on a LAN host, even same-origin", () => {
  const d = checkRequest({
    secFetchSite: "same-origin",
    origin: "http://192.168.1.50:3000",
    host: "192.168.1.50:3000",
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, false);
  assert.equal(d.status, 403);
});

test("allows a LAN host that is explicitly opted in", () => {
  const d = checkRequest({
    secFetchSite: "same-origin",
    origin: "http://192.168.1.50:3000",
    host: "192.168.1.50:3000",
    allowedHosts: parseAllowedHosts("192.168.1.50"),
  });
  assert.equal(d.ok, true);
});

test("blocks a request with no Host header", () => {
  const d = checkRequest({
    secFetchSite: "same-origin",
    origin: null,
    host: null,
    allowedHosts: parseAllowedHosts(""),
  });
  assert.equal(d.ok, false);
});

test("a cross-site request is blocked even on an allowed LAN host", () => {
  const d = checkRequest({
    secFetchSite: "cross-site",
    origin: "https://evil.example.com",
    host: "192.168.1.50:3000",
    allowedHosts: parseAllowedHosts("192.168.1.50"),
  });
  assert.equal(d.ok, false);
});
