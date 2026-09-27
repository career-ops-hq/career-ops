"use client";

import { useState, useEffect } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Copy, Check, Terminal } from "lucide-react";

type CheckItem = {
  category: string;
  name: string;
  status: "ok" | "warn" | "error";
  details: string;
  fix?: string;
};

export default function DiagnosticsPage() {
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [timestamp, setTimestamp] = useState("");
  const [root, setRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [copiedFix, setCopiedFix] = useState<string | null>(null);

  const fetchDiagnostics = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/diagnostics");
      const data = await res.json();
      setChecks(data.checks || []);
      setTimestamp(data.timestamp || "");
      setRoot(data.root || "");
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const copyText = (txt: string, id: string) => {
    navigator.clipboard.writeText(txt);
    setCopiedFix(id);
    setTimeout(() => setCopiedFix(null), 2000);
  };

  const categories = Array.from(new Set(checks.map((c) => c.category)));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Activity className="size-6 text-brand" />
            System Diagnostics & Health Check
          </h1>
          <p className="text-xs text-muted mt-1">
            Validates your local Node environment, user data paths, and prerequisite files.
          </p>
        </div>
        <button
          onClick={fetchDiagnostics}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-surface-hover border border-border px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-surface"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Re-run Checks
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 flex items-center justify-between text-xs">
        <div>
          <span className="text-muted">Data Root:</span> <code className="font-mono text-foreground font-bold">{root}</code>
        </div>
        <div className="text-faint">
          Last checked: {timestamp ? new Date(timestamp).toLocaleTimeString() : "—"}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-sm text-muted">Running system diagnostics...</div>
      ) : (
        <div className="space-y-6">
          {categories.map((cat) => (
            <div key={cat} className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-faint">{cat}</h3>
              <div className="space-y-2">
                {checks
                  .filter((c) => c.category === cat)
                  .map((c, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-border bg-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        {c.status === "ok" ? (
                          <CheckCircle2 className="size-5 text-emerald-400 shrink-0 mt-0.5" />
                        ) : c.status === "warn" ? (
                          <AlertTriangle className="size-5 text-amber-400 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="text-sm font-semibold text-foreground">{c.name}</div>
                          <div className="text-xs text-muted mt-0.5">{c.details}</div>
                          {c.status !== "ok" && c.fix && (
                            <div className="mt-2 text-xs text-amber-300 bg-amber-950/20 border border-amber-500/20 p-2 rounded-md">
                              <strong>Suggested Fix:</strong> {c.fix}
                            </div>
                          )}
                        </div>
                      </div>

                      {c.status !== "ok" && c.fix && (
                        <button
                          onClick={() => copyText(c.fix!, `${cat}-${i}`)}
                          className="shrink-0 flex items-center gap-1.5 rounded-lg bg-surface-hover border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface self-start sm:self-center"
                        >
                          {copiedFix === `${cat}-${i}` ? <Check className="size-3 text-brand" /> : <Copy className="size-3" />}
                          <span>Copy Fix</span>
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
