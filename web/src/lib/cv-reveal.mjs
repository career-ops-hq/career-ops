import path from "node:path";
import { cvPdfSelectors } from "./cv-pdf-query.mjs";

export function revealArgv(platform, file) {
  if (platform === "darwin") return { command: "open", args: ["-R", file] };
  if (platform === "win32") return { command: "explorer", args: [`/select,${file}`] };
  if (platform === "linux") return { command: "xdg-open", args: [path.dirname(file)] };
  return null;
}

function relativeInside(root, file) {
  if (!root || !file) return null;
  const rel = path.relative(root, file);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel;
}

export function revealResolvedFile({ file, platform, spawn, root }) {
  const rel = relativeInside(root, file);
  if (!rel) return { status: 404, body: "tailored CV is unavailable" };
  const spec = revealArgv(platform, file);
  if (!spec) return { status: 501, body: rel };
  let child;
  try {
    child = spawn(spec.command, spec.args, { stdio: "ignore", windowsHide: true });
  } catch {
    return { status: 500, body: "Could not reveal the file." };
  }
  if (!child || typeof child.on !== "function") return { status: 500, body: "Could not reveal the file." };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    // A missing binary emits `error` asynchronously. With no listener, that crashes the process.
    child.on("error", () => finish({ status: 500, body: "Could not reveal the file." }));
    child.on("spawn", () => {
      if (typeof child.unref === "function") child.unref();
      finish({ status: 204, body: "" });
    });
  });
}

export async function revealCvRequest({ searchParams, locate, platform, spawn, root }) {
  const selectors = cvPdfSelectors(searchParams);
  const located = await locate(selectors);
  if (!located?.file) {
    return {
      status: Number.isInteger(located?.status) ? located.status : 404,
      body: typeof located?.message === "string" ? located.message : "tailored CV is unavailable",
    };
  }
  return revealResolvedFile({ file: located.file, platform, spawn, root });
}
