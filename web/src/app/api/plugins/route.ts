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

export const KNOWN_PLUGINS: PluginInfo[] = [
  {
    id: "gmail",
    name: "Gmail Integration",
    description: "Auto-sync inbound recruiter messages and interview invitations for reply-watch classification.",
    enabled: false,
    hooks: ["ingest", "reply-watch"],
    requiredEnv: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
    configured: false,
  },
  {
    id: "notion",
    name: "Notion Sync",
    description: "Export pipeline applications and evaluation reports to your personal Notion database.",
    enabled: false,
    hooks: ["export", "search"],
    requiredEnv: ["NOTION_ACCESS_TOKEN", "NOTION_PARENT_PAGE_ID"],
    configured: false,
  },
  {
    id: "apify",
    name: "Apify Web Scraper",
    description: "Cloud-scale job portal scraping for platforms requiring anti-bot bypassing.",
    enabled: false,
    hooks: ["provider", "scan"],
    requiredEnv: ["APIFY_TOKEN"],
    configured: false,
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

export async function GET() {
  const root = careerOpsRoot();
  const plugins: PluginInfo[] = KNOWN_PLUGINS.map((p) => ({
    ...p,
    configured: p.requiredEnv.length === 0 || p.requiredEnv.every((k) => Boolean(process.env[k]?.trim())),
  }));

  // Check which are enabled in plugins/ or config
  const enabledConfigPath = path.join(root, "config", "plugins.json");
  let enabledList: string[] = [];
  if (fs.existsSync(enabledConfigPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(enabledConfigPath, "utf8"));
      if (Array.isArray(parsed)) {
        enabledList = parsed;
      } else {
        return Response.json({ error: "plugins.json is not an array" }, { status: 500 });
      }
    } catch {
      return Response.json({ error: "Failed to parse plugins.json" }, { status: 500 });
    }
  }

  for (const plugin of plugins) {
    plugin.enabled = enabledList.includes(plugin.id);
  }

  return Response.json({ plugins });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { pluginId, enabled } = body;

    if (!pluginId || typeof pluginId !== "string") {
      return Response.json({ error: "Plugin ID is required" }, { status: 400 });
    }

    if (!KNOWN_PLUGINS.some((p) => p.id === pluginId)) {
      return Response.json({ error: `Unknown plugin ID: ${pluginId}` }, { status: 400 });
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
        const parsed = JSON.parse(fs.readFileSync(enabledConfigPath, "utf8"));
        if (Array.isArray(parsed)) {
          enabledList = parsed;
        } else {
          return Response.json({ error: "plugins.json is not an array" }, { status: 500 });
        }
      } catch {
        return Response.json({ error: "Failed to parse plugins.json" }, { status: 500 });
      }
    }

    if (enabled) {
      if (!enabledList.includes(pluginId)) enabledList.push(pluginId);
    } else {
      enabledList = enabledList.filter((id) => id !== pluginId);
    }

    atomicWrite(enabledConfigPath, JSON.stringify(enabledList, null, 2));

    return Response.json({ success: true, enabledList });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
