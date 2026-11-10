import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { rootScript } from "@/lib/career-ops";
import { isRealISODate } from "@/lib/followups";
import { parseFollowupId } from "@/lib/followup-id.mjs";
import { FollowupsBusyError, followupsLogPath, followupsWriteError, withLogLock } from "@/lib/followups-server";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReplaceNextPin = (
  appNum: number,
  options: { date: string; followupsPath: string; lockTimeoutMs?: number },
) => Promise<{ changed: boolean }>;

type ClearNextPin = (
  appNum: number,
  options: { followupsPath: string; lockTimeoutMs?: number },
) => Promise<{ cleared: boolean }>;

function webLockTimeoutMs(): number {
  return Number(process.env.CAREER_OPS_WEB_FOLLOWUPS_LOCK_TIMEOUT_MS) || 5_000;
}

async function pinApi(): Promise<{ replaceNextPin: ReplaceNextPin; clearNextPin: ClearNextPin }> {
  // The core script is chosen at runtime. A static import would make the
  // bundler trace the engine checkout into this route.
  const file = rootScript("followup-seed");
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(file).href);
  if (typeof mod.replaceNextPin !== "function" || typeof mod.clearNextPin !== "function") {
    throw new Error("followup-seed.mjs is missing replaceNextPin or clearNextPin");
  }
  return { replaceNextPin: mod.replaceNextPin, clearNextPin: mod.clearNextPin };
}

function rethrowBusy(error: unknown): never {
  const err = error as { name?: string; code?: string } | null;
  if (err && err.name === "SeedError" && err.code === "LOCK_TIMEOUT") {
    throw new FollowupsBusyError();
  }
  throw error;
}

export async function POST(req: Request) {
  const body = await readJsonObject<{ appNum?: string | number; date?: string }>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const appNum = parseFollowupId(body.appNum);
  if (appNum === null) {
    return Response.json({ error: "appNum (application #) required" }, { status: 400 });
  }
  const date = (body.date ?? "").trim();
  if (!isRealISODate(date)) {
    return Response.json({ error: "date must be a real calendar date (YYYY-MM-DD)" }, { status: 400 });
  }

  const file = followupsLogPath();
  try {
    return await withLogLock(async () => {
      const { replaceNextPin } = await pinApi();
      try {
        await replaceNextPin(appNum, { date, followupsPath: file, lockTimeoutMs: webLockTimeoutMs() });
      } catch (error) {
        rethrowBusy(error);
      }
      return Response.json({ ok: true, appNum, date });
    });
  } catch (e) {
    return followupsWriteError(e, "write failed");
  }
}

export async function DELETE(req: Request) {
  const body = await readJsonObject<{ appNum?: string | number }>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const appNum = parseFollowupId(body.appNum);
  if (appNum === null) {
    return Response.json({ error: "appNum (application #) required" }, { status: 400 });
  }

  const file = followupsLogPath();
  if (!fs.existsSync(file)) return Response.json({ error: "no follow-up log" }, { status: 404 });
  try {
    return await withLogLock(async () => {
      const { clearNextPin } = await pinApi();
      let cleared = false;
      try {
        cleared = (await clearNextPin(appNum, { followupsPath: file, lockTimeoutMs: webLockTimeoutMs() })).cleared;
      } catch (error) {
        rethrowBusy(error);
      }
      if (!cleared) {
        return Response.json({ error: `no pinned next-date for application #${appNum}` }, { status: 404 });
      }
      return Response.json({ ok: true, appNum });
    });
  } catch (e) {
    return followupsWriteError(e, "delete failed");
  }
}
