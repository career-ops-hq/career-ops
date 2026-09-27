import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export type PluginInfo = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  hooks: string[];
  requiredEnv: string[];
  configured: boolean;
};

export async function GET() {
  const root = careerOpsRoot();
  const pluginsDir = path.join(root, "plugins");

  const knownPlugins: PluginInfo[] = [
    {
      id: "gmail",
      name: "Gmail Integration",
      description: "Auto-sync inbound recruiter messages and interview invitations for reply-watch classification.",
      enabled: false,
      hooks: ["ingest", "reply-watch"],
      requiredEnv: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
      configured: Boolean(process.env.GMAIL_REFRESH_TOKEN),
    },
    {
      id: "notion",
      name: "Notion Sync",
      description: "Export pipeline applications and evaluation reports to your personal Notion database.",
      enabled: false,
      hooks: ["export", "search"],
      requiredEnv: ["NOTION_ACCESS_TOKEN", "NOTION_PARENT_PAGE_ID"],
      configured: Boolean(process.env.NOTION_ACCESS_TOKEN),
    },
    {
      id: "apify",
      name: "Apify Web Scraper",
      description: "Cloud-scale job portal scraping for platforms requiring anti-bot bypassing.",
      enabled: false,
      hooks: ["provider", "scan"],
      requiredEnv: ["APIFY_TOKEN"],
      configured: Boolean(process.env.APIFY_TOKEN),
    },
    {
      id: "h1b-sponsor",
      name: "H1B Sponsor Radar",
      description: "Annotates discovered company job listings with historical USCIS H1B visa filing data.",
      enabled: false,
      hooks: ["ingest", "enrichment"],
      requiredEnv: [],
      configured: true,
    },
  ];

  // Check which are enabled in plugins/ or config
  const enabledConfigPath = path.join(root, "config", "plugins.json");
  let enabledList: string[] = [];
  if (fs.existsSync(enabledConfigPath)) {
    try {
      enabledList = JSON.parse(fs.readFileSync(enabledConfigPath, "utf8"));
    } catch {}
  }

  for (const plugin of knownPlugins) {
    plugin.enabled = enabledList.includes(plugin.id);
  }

  return NextResponse.json({ plugins: knownPlugins });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { pluginId, enabled } = body;

    if (!pluginId) {
      return NextResponse.json({ error: "Plugin ID is required" }, { status: 400 });
    }

    const root = careerOpsRoot();
    const configDir = path.join(root, "config");
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const enabledConfigPath = path.join(configDir, "plugins.json");
    let enabledList: string[] = [];
    if (fs.existsSync(enabledConfigPath)) {
      try {
        enabledList = JSON.parse(fs.readFileSync(enabledConfigPath, "utf8"));
      } catch {}
    }

    if (enabled) {
      if (!enabledList.includes(pluginId)) enabledList.push(pluginId);
    } else {
      enabledList = enabledList.filter((id) => id !== pluginId);
    }

    atomicWrite(enabledConfigPath, JSON.stringify(enabledList, null, 2));

    return NextResponse.json({ success: true, enabledList });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
