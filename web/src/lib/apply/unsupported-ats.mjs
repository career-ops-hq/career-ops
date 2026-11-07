import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveCodeRoot, resolveRootScript } from "../core/code-root.mjs";
import { checklistHrefFor } from "./checklist-href.mjs";

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
 * @param {string} label
 * @param {boolean} [opened] True when a window was opened and then closed.
 */
export function unsupportedAtsMessage(label, opened = false) {
  const lead = `This posting is on ${label}. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app`;
  return opened ? `${lead}. The window was closed.` : `${lead}, so no browser was opened.`;
}

/**
 * @param {unknown} url
 * @returns {Promise<{ vendor: "workday" | "icims" | "ultipro", label: string, postingUrl: string } | null>}
 */
export async function unsupportedInAppAts(url) {
  const { atsVendorOf } = await loadAtsVendor();
  const vendor = atsVendorOf(url);
  if (typeof vendor !== "string" || !Object.hasOwn(LABELS, vendor)) return null;
  return {
    vendor: /** @type {"workday" | "icims" | "ultipro"} */ (vendor),
    label: LABELS[vendor],
    postingUrl: new URL(String(url).trim()).href,
  };
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
    message: unsupportedAtsMessage(hit.label, opened),
  };
  const checklistHref = checklistHrefFor(applicationNumber);
  if (checklistHref) body.checklistHref = checklistHref;
  return body;
}
