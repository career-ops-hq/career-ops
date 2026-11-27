import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveCodeRoot, resolveRootScript } from "../core/code-root.mjs";
import { checklistHrefFor } from "./checklist-href.mjs";
import { matchHandoffHost, readHandoffHosts } from "./handoff-hosts.mjs";

export { checklistHrefFor };

// Server-only. The host table stays in ats-vendor.mjs. A static import of that
// engine file is outside the web bundle root, so this loads it at runtime.

/** @type {Promise<{ atsVendorOf: (url: unknown) => string | null }> | null} */
let vendorModule = null;

const LABELS = {
  workday: "Workday",
  icims: "iCIMS",
  ultipro: "UKG",
};

function atsVendorFile() {
  const explicit = (process.env.CAREER_OPS_CODE_ROOT || "").trim();
  if (explicit) return resolveRootScript(resolveCodeRoot(process.cwd(), process.env), "ats-vendor");
  // resolveCodeRoot assumes cwd is <checkout>/web. The node test runner's cwd
  // is the checkout, so that walk lands on the parent directory and the import
  // misses ats-vendor.mjs. Prefer a candidate that exists.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolveRootScript(resolveCodeRoot(process.cwd(), process.env), "ats-vendor"),
    resolveRootScript(path.resolve(process.cwd()), "ats-vendor"),
    resolveRootScript(path.resolve(here, "../../../.."), "ats-vendor"),
  ];
  return candidates.find((file) => existsSync(file)) || candidates[0];
}

function loadAtsVendor() {
  if (!vendorModule) {
    const file = atsVendorFile();
    const pending = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(file).href).then(
      (mod) => mod,
      (err) => {
        if (vendorModule === pending) vendorModule = null;
        throw err;
      },
    );
    vendorModule = pending;
  }
  return vendorModule;
}

/**
 * @param {string | { vendor?: string, label: string }} hit The refused hit, or just its label.
 * @param {boolean} [opened] True when a window was opened and then closed.
 */
export function unsupportedAtsMessage(hit, opened = false) {
  const label = typeof hit === "string" ? hit : hit.label;
  if (typeof hit === "object" && hit.vendor === "handoff") {
    const lead = `This posting is on ${label}, which you listed in apply.handoff_hosts (config/profile.yml) as a site you sign in to yourself. Career-ops does not drive it in the app`;
    return opened ? `${lead}. The window was closed.` : `${lead}, so no browser was opened.`;
  }
  const lead = `This posting is on ${label}. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app`;
  return opened ? `${lead}. The window was closed.` : `${lead}, so no browser was opened.`;
}

/**
 * Workday, iCIMS and UKG, plus any host the user listed in
 * config/profile.yml → apply.handoff_hosts (handoff-hosts.mjs).
 *
 * @param {unknown} url
 * @param {{ handoffHosts?: string[] }} [opts] Hosts to use instead of the profile's (tests).
 * @returns {Promise<{ vendor: "workday" | "icims" | "ultipro" | "handoff", label: string, postingUrl: string } | null>}
 */
export async function unsupportedInAppAts(url, opts = {}) {
  const { atsVendorOf } = await loadAtsVendor();
  const vendor = atsVendorOf(url);
  if (typeof vendor === "string" && Object.hasOwn(LABELS, vendor)) {
    return {
      vendor: /** @type {"workday" | "icims" | "ultipro"} */ (vendor),
      label: LABELS[vendor],
      postingUrl: new URL(String(url).trim()).href,
    };
  }
  const host = matchHandoffHost(url, opts.handoffHosts ?? readHandoffHosts());
  if (!host) return null;
  return { vendor: "handoff", label: host, postingUrl: new URL(String(url).trim()).href };
}

/**
 * HTTP body for a refusal. checklistHref is present only for a numeric application id.
 *
 * @param {{ vendor: string, label: string, postingUrl: string }} hit
 * @param {unknown} applicationNumber
 * @param {boolean} [opened] True when a window was opened and then closed.
 */
export function unsupportedSessionJson(hit, applicationNumber, opened = false) {
  /** @type {{ unsupported: true, vendor: string, label: string, postingUrl: string, message: string, checklistHref?: string }} */
  const body = {
    unsupported: true,
    vendor: hit.vendor,
    label: hit.label,
    postingUrl: hit.postingUrl,
    message: unsupportedAtsMessage(hit, opened),
  };
  const checklistHref = checklistHrefFor(applicationNumber);
  if (checklistHref) body.checklistHref = checklistHref;
  return body;
}
