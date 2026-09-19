import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { careerOpsRoot } from "@/lib/career-ops";
import { readLockStatus } from "./scheduled-jobs-store.mjs";
import { scheduledRunnerResourcePath, scheduledStorePath } from "./scheduled-runner-path.mjs";

const execFileAsync = promisify(execFile);
const TASK_NAME = "career-ops recurring scan";

export type SchedulerStatus = {
  available: boolean;
  running: boolean;
  task: {
    exists: boolean;
    enabled: boolean;
    status: string | null;
    nextRun: string | null;
    lastRun: string | null;
  };
};

async function readTask(): Promise<SchedulerStatus["task"]> {
  if (process.platform !== "win32") {
    return { exists: false, enabled: false, status: null, nextRun: null, lastRun: null };
  }

  const script = [
    `$task = Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue`,
    "if (-not $task) { Write-Output '{\"exists\":false}'; exit 0 }",
    `$info = Get-ScheduledTaskInfo -TaskName '${TASK_NAME}'`,
    "$result = [PSCustomObject]@{",
    "  exists = $true",
    "  enabled = ($task.State -ne 'Disabled')",
    "  status = [string]$task.State",
    "  nextRun = if ($info.NextRunTime -gt [DateTime]::MinValue) { $info.NextRunTime.ToString('o') } else { $null }",
    "  lastRun = if ($info.LastRunTime -gt [DateTime]::MinValue) { $info.LastRunTime.ToString('o') } else { $null }",
    "}",
    "$result | ConvertTo-Json -Compress",
  ].join("; ");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 5_000, maxBuffer: 128 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as Partial<SchedulerStatus["task"]>;
    return {
      exists: parsed.exists === true,
      enabled: parsed.enabled === true,
      status: typeof parsed.status === "string" ? parsed.status : null,
      nextRun: typeof parsed.nextRun === "string" ? parsed.nextRun : null,
      lastRun: typeof parsed.lastRun === "string" ? parsed.lastRun : null,
    };
  } catch {
    return { exists: false, enabled: false, status: null, nextRun: null, lastRun: null };
  }
}

export async function schedulerStatus(): Promise<SchedulerStatus> {
  const root = careerOpsRoot();
  const runner = path.join(root, "scripts", "scheduled-jobs-runner.mjs");
  const runnerLock = scheduledRunnerResourcePath(scheduledStorePath(root));
  const lock = readLockStatus(runnerLock, { staleMs: 25 * 60 * 1_000 * 3 + 60_000 });
  return {
    available: fs.existsSync(runner),
    running: lock.active && !lock.stale,
    task: await readTask(),
  };
}
