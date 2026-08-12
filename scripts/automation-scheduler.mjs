const endpoint = process.env.CAREER_OPS_AUTOMATION_URL || "http://127.0.0.1:3111/api/automation";
const attempts = 45;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run", force: false }),
        signal: AbortSignal.timeout(300_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      process.stdout.write(`${new Date().toISOString()} ${body.skipped ? "ingen körning behövdes" : "bevakning körd"}\n`);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await wait(2_000);
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
