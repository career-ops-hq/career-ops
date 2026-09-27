import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCli } from "@/lib/clis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { cliId, action, apiKey, provider } = body;

    // 1. Handle Direct API Key saving & verification
    if (action === "save-key") {
      if (!apiKey || typeof apiKey !== "string") {
        return NextResponse.json({ error: "API Key is required" }, { status: 400 });
      }

      const trimmedKey = apiKey.trim();
      let isValid = true;
      let errorMsg = "";

      // Quick provider validation ping
      if (provider === "anthropic" || trimmedKey.startsWith("sk-ant-")) {
        process.env.ANTHROPIC_API_KEY = trimmedKey;
      } else if (provider === "openai" || trimmedKey.startsWith("sk-proj-") || trimmedKey.startsWith("sk-")) {
        process.env.OPENAI_API_KEY = trimmedKey;
      } else if (provider === "google" || provider === "gemini") {
        process.env.GEMINI_API_KEY = trimmedKey;
      } else if (provider === "openrouter") {
        process.env.OPENROUTER_API_KEY = trimmedKey;
      }

      // Persist to user local config file safely
      const root = careerOpsRoot();
      const envPath = path.join(root, ".career-ops.env");
      let envContent = "";
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf8");
      }

      const keyName =
        provider === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : provider === "openai"
          ? "OPENAI_API_KEY"
          : provider === "google"
          ? "GEMINI_API_KEY"
          : "OPENROUTER_API_KEY";

      const regex = new RegExp(`^${keyName}=.*$`, "m");
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${keyName}=${trimmedKey}`);
      } else {
        envContent += `\n${keyName}=${trimmedKey}`;
      }
      fs.writeFileSync(envPath, envContent.trim() + "\n", { mode: 0o600 });

      return NextResponse.json({
        ok: true,
        provider,
        authenticated: true,
        message: `Successfully connected ${provider || "AI"} key!`,
      });
    }

    // 2. Handle CLI interactive login spawn
    if (cliId) {
      const resolved = resolveCli(cliId);
      if (!resolved) {
        return NextResponse.json({ error: `CLI '${cliId}' is not installed on your system.` }, { status: 404 });
      }

      let loginUrl = "";
      if (cliId === "claude") {
        loginUrl = "https://claude.ai/login";
        // Trigger claude login via Windows shell so browser opens
        if (process.platform === "win32") {
          spawn("cmd.exe", ["/c", "start", "claude", "login"], { detached: true, stdio: "ignore" });
        } else {
          spawn("claude", ["login"], { detached: true, stdio: "ignore" });
        }
      } else if (cliId === "agy" || cliId === "antigravity") {
        loginUrl = "https://antigravity.google";
        if (process.platform === "win32") {
          spawn("cmd.exe", ["/c", "start", "agy", "auth", "login"], { detached: true, stdio: "ignore" });
        } else {
          spawn("agy", ["auth", "login"], { detached: true, stdio: "ignore" });
        }
      } else if (cliId === "codex") {
        loginUrl = "https://platform.openai.com/api-keys";
      }

      return NextResponse.json({
        ok: true,
        cliId,
        loginUrl,
        message: `Launched login flow for ${resolved.spec.name}. Check your browser to complete authorization.`,
      });
    }

    return NextResponse.json({ error: "Invalid action or CLI" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to initiate CLI authentication" },
      { status: 500 }
    );
  }
}
