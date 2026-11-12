import fs from "node:fs";
import { NextResponse } from "next/server";
import { rootScript } from "@/lib/career-ops";
import { runCoreCli } from "@/lib/core-cli";
import { parseCliJson, trackerRowArg } from "@/lib/status-cli.mjs";
import { coreScriptHttp } from "@/lib/core-script-result.mjs";

export function digitArg(value: unknown): string | null {
  return trackerRowArg(value);
}

export async function postCoreScript(opts: {
  script: string;
  args: string[];
  logLabel: string;
  fallback: string;
}): Promise<NextResponse> {
  if (!fs.existsSync(rootScript(opts.script))) {
    return NextResponse.json(
      { error: `${opts.logLabel} needs the career-ops scripts`, code: "core-script-missing" },
      { status: 503 },
    );
  }
  const result = await runCoreCli(opts.script, opts.args);
  if (result.spawnFailed) {
    console.error(`/${opts.logLabel}: failed to run: ${result.stderr.trim()}`);
    return NextResponse.json({ error: opts.fallback }, { status: 500 });
  }
  if (result.timedOut) {
    return NextResponse.json(
      { error: `${opts.logLabel} timed out` },
      { status: 504, headers: { "Retry-After": "5" } },
    );
  }
  const parsed = parseCliJson(result.stdout);
  if (result.code !== 0 && result.code !== 1) {
    console.error(`/${opts.logLabel}: exit ${result.code}: ${result.stderr.trim()}`);
  }
  const mapped = coreScriptHttp({ code: result.code, parsed, fallback: opts.fallback });
  return NextResponse.json(mapped.body, { status: mapped.status });
}
