"use client";

import { useState, useEffect } from "react";
import { Blocks, CheckCircle2, XCircle, ShieldCheck, ExternalLink, Key, Power } from "lucide-react";

type Plugin = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  hooks: string[];
  requiredEnv: string[];
  configured: boolean;
};

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchPlugins = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/plugins");
      const data = await res.json();
      setPlugins(data.plugins || []);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlugins();
  }, []);

  const togglePlugin = async (plugin: Plugin) => {
    setToggling(plugin.id);
    try {
      await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluginId: plugin.id, enabled: !plugin.enabled }),
      });
      await fetchPlugins();
    } catch {}
    finally {
      setToggling(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Blocks className="size-6 text-brand" />
            Plugins & Integrations
          </h1>
          <p className="text-xs text-muted mt-1">
            Optional third-party integrations (Gmail, Notion, Apify, H1B Radar). All plugins are opt-in, disabled by default, and isolated from core scoring.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? (
          <div className="p-12 text-center text-sm text-muted col-span-2">Loading plugins...</div>
        ) : (
          plugins.map((plugin) => (
            <div
              key={plugin.id}
              className={`rounded-xl border p-5 bg-surface flex flex-col justify-between shadow-sm space-y-4 ${
                plugin.enabled ? "border-brand/40 bg-brand-soft/5" : "border-border"
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-base text-foreground">{plugin.name}</h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      {plugin.hooks.map((h) => (
                        <span key={h} className="rounded bg-surface-hover border border-border px-1.5 py-0.5 text-[10px] font-mono text-faint">
                          hook:{h}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${
                      plugin.enabled
                        ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                        : "bg-surface-hover border border-border text-muted"
                    }`}
                  >
                    {plugin.enabled ? (
                      <>
                        <CheckCircle2 className="size-3" /> Enabled
                      </>
                    ) : (
                      "Disabled"
                    )}
                  </span>
                </div>

                <p className="text-xs text-muted leading-relaxed">{plugin.description}</p>

                {plugin.requiredEnv.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[11px] font-semibold text-faint flex items-center gap-1">
                      <Key className="size-3" /> Required Environment Variables:
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {plugin.requiredEnv.map((env) => (
                        <code key={env} className="rounded bg-surface-hover border border-border px-1.5 py-0.5 text-[10px] font-mono text-foreground">
                          {env}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-border/60 flex items-center justify-between">
                <div className="text-[11px] text-faint">
                  {plugin.configured ? "✓ Credentials detected" : "Configure in web/.env.local"}
                </div>
                <button
                  onClick={() => togglePlugin(plugin)}
                  disabled={toggling === plugin.id}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    plugin.enabled
                      ? "bg-surface-hover border border-border text-foreground hover:bg-red-500/10 hover:text-red-400"
                      : "bg-brand text-white hover:opacity-90"
                  }`}
                >
                  <Power className="size-3.5" />
                  {toggling === plugin.id ? "Updating..." : plugin.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
