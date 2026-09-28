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

    const ALLOWED_PROVIDERS: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GEMINI_API_KEY",
      gemini: "GEMINI_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    };

    // 1. Handle Direct API Key saving & verification
    if (action === "save-key") {
      if (!apiKey || typeof apiKey !== "string") {
        return NextResponse.json({ error: "API Key is required" }, { status: 400 });
      }

      if (/[\r\n]/.test(apiKey)) {
        return NextResponse.json({ error: "API Key must not contain newlines" }, { status: 400 });
      }

      const provKey = (provider || "").toLowerCase().trim();
      const keyName = ALLOWED_PROVIDERS[provKey];
      if (!keyName) {
        return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
      }

      const trimmedKey = apiKey.trim();
      process.env[keyName] = trimmedKey;

      // Persist to user local config file safely
      const root = careerOpsRoot();
      const envPath = path.join(root, ".career-ops.env");
      let envContent = "";
      if (fs.existsSync(envPath)) {
        try {
          fs.chmodSync(envPath, 0o600);
        } catch (err) {
          console.error("Failed to set permissions on .career-ops.env:", err);
          return NextResponse.json({ error: "Failed to secure permissions on .career-ops.env" }, { status: 500 });
        }
        envContent = fs.readFileSync(envPath, "utf8");
      }

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
      let loginArgs: string[] = [];
      if (cliId === "claude") {
        loginUrl = "https://claude.ai/login";
        loginArgs = ["login"];
      } else if (cliId === "agy" || cliId === "antigravity") {
        loginUrl = "https://antigravity.google";
        loginArgs = ["auth", "login"];
      } else if (cliId === "codex") {
        loginUrl = "https://platform.openai.com/api-keys";
      }

      if (loginArgs.length > 0) {
        try {
          const child = spawn(resolved.binPath, loginArgs, {
            detached: true,
            stdio: "ignore",
            shell: process.platform === "win32",
          });
          child.on("error", (err) => {
            console.error(`Failed to launch ${resolved.spec.name} login:`, err);
          });
          child.unref();
        } catch (e) {
          console.error("Failed to spawn login process:", e);
        }
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
