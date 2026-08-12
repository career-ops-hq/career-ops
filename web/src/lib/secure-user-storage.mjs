import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

function resolvedWithin(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Ogiltig lagringssökväg utanför Career-Ops-roten.");
  }
  return resolvedTarget;
}

async function rejectSymlink(target) {
  try {
    const details = await lstat(target);
    if (details.isSymbolicLink()) {
      throw new Error("Symboliska länkar tillåts inte för privat karriärdata.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function bestEffortChmod(target, mode) {
  try {
    await chmod(target, mode);
  } catch (error) {
    if (!["ENOTSUP", "EPERM", "EINVAL"].includes(error?.code)) throw error;
  }
}

export async function ensurePrivateDirectory(root, directory) {
  const target = resolvedWithin(root, directory);
  await rejectSymlink(target);
  await mkdir(target, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await bestEffortChmod(target, PRIVATE_DIRECTORY_MODE);
  return target;
}

export async function secureReadText(root, target, fallback = "") {
  const resolved = resolvedWithin(root, target);
  await rejectSymlink(resolved);
  try {
    return await readFile(resolved, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function secureAtomicWrite(root, target, content) {
  const resolved = resolvedWithin(root, target);
  const directory = await ensurePrivateDirectory(root, path.dirname(resolved));
  await rejectSymlink(resolved);

  const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(String(content), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporary, resolved);
    await bestEffortChmod(resolved, PRIVATE_FILE_MODE);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return resolved;
}

export function resolvePrivatePath(root, relativePath) {
  return resolvedWithin(root, path.join(root, relativePath));
}

export async function privateFileExists(root, target) {
  const resolved = resolvedWithin(root, target);
  await rejectSymlink(resolved);
  try {
    await access(resolved, constants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function secureDelete(root, target) {
  const resolved = resolvedWithin(root, target);
  await rejectSymlink(resolved);
  try {
    await unlink(resolved);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { ok: true };
}
