import { pathToFileURL } from "node:url";
import { resolveCodeRoot, resolveRootScript } from "../core/code-root.mjs";

// Server-only. The host table stays in ats-vendor.mjs. A static import of that
// engine file is outside the web bundle root, so this loads it at runtime.

/** @type {Promise<{ atsVendorOf: (url: unknown) => string | null }> | null} */
let vendorModule = null;

const LABELS = {
  workday: "Workday",
  icims: "iCIMS",
  ultipro: "UKG",
};

function loadAtsVendor() {
  if (!vendorModule) {
    const file = resolveRootScript(resolveCodeRoot(process.cwd(), process.env), "ats-vendor");
    vendorModule = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(file).href);
  }
  return vendorModule;
}

/**
 * @param {string} label
 */
export function unsupportedAtsMessage(label) {
  return `This posting is on ${label}. Career-ops cannot fill Workday, iCIMS, or UKG forms in the app, so no browser was opened.`;
}

/**
 * Tracker and report ids are digits. Anything else is omitted so the checklist
 * link cannot carry a path.
 *
 * @param {unknown} applicationNumber
 * @returns {string | null}
 */
export function checklistHrefFor(applicationNumber) {
  const id = typeof applicationNumber === "string" || typeof applicationNumber === "number" ? String(applicationNumber).trim() : "";
  if (!/^\d+$/.test(id)) return null;
  return `/pipeline/${id}/apply`;
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
 */
export function unsupportedSessionJson(hit, applicationNumber) {
  /** @type {{ unsupported: true, vendor: string, label: string, postingUrl: string, message: string, checklistHref?: string }} */
  const body = {
    unsupported: true,
    vendor: hit.vendor,
    label: hit.label,
    postingUrl: hit.postingUrl,
    message: unsupportedAtsMessage(hit.label),
  };
  const checklistHref = checklistHrefFor(applicationNumber);
  if (checklistHref) body.checklistHref = checklistHref;
  return body;
}
