"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/* ── Types ──────────────────────────────────────────────────────────── */

type MessageTypeId =
  | "cover-letter"
  | "short-motivation"
  | "why-good-fit"
  | "recruiter-message"
  | "linkedin-message"
  | "email-application"
  | "follow-up"
  | "interview-confirmation"
  | "thank-you"
  | "faq-answers";

interface FactRef {
  label: string;
  value: string;
  source: string;
}

interface StudioMessage {
  id: string;
  type: MessageTypeId;
  title: string;
  subject?: string;
  body: string;
  factsUsed: FactRef[];
  missingFacts: string[];
  settings: { length: string; style: string; language: string };
  draft: boolean;
  version: number;
  versions: Array<{ version: number; body: string; editedAt: string; by: string }>;
  createdAt: string;
  updatedAt: string;
}

interface StudioPackage {
  packageId: string;
  job: { company: string; role: string; location: string } | null;
  messages: StudioMessage[];
  settings: { length: string; style: string; language: string };
  status: string;
  history: Array<{ at: string; event: string; status: string; messageId?: string; version?: number; from?: string; to?: string }>;
}

interface PipelineJob {
  n: string;
  company: string;
  role: string;
  status: string;
  score?: number;
}

const FLOW_STEPS = ["VALT JOBB", "CV", "MATCH", "ANPASSAT CV", "PERSONLIGT BREV", "ANSÖKNINGSFRÅGOR", "MEDDELANDEN", "REVIEW", "READY TO APPLY"];

const LENGTH_OPTIONS = [
  { id: "short", label: "Kort" },
  { id: "standard", label: "Standard" },
  { id: "detailed", label: "Utförlig" },
];
const STYLE_OPTIONS = [
  { id: "professional", label: "Professionell" },
  { id: "human", label: "Mänsklig" },
  { id: "technical", label: "Teknisk" },
  { id: "leadership", label: "Ledarskap" },
  { id: "sales", label: "Säljande" },
];
const LANGUAGE_OPTIONS = [
  { id: "auto", label: "Automatiskt (efter jobb/land)" },
  { id: "sv", label: "Svenska" },
  { id: "en", label: "Engelska" },
];

/* ── Helpers ────────────────────────────────────────────────────────── */

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function patchJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/* ── Main workspace ─────────────────────────────────────────────────── */

export function ApplicationStudioWorkspace() {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [jobId, setJobId] = useState("");
  const [cvVersions, setCvVersions] = useState<Array<{ id: string; label: string }>>([]);
  const [cvVersionId, setCvVersionId] = useState("");
  const [length, setLength] = useState("standard");
  const [style, setStyle] = useState("professional");
  const [language, setLanguage] = useState("auto");
  const [pkg, setPkg] = useState<StudioPackage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [expandedFacts, setExpandedFacts] = useState<string>("");
  const [activeStep, setActiveStep] = useState(0);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline", { cache: "no-store" });
      const data = await res.json();
      const apps = Array.isArray(data?.applications) ? data.applications : [];
      setJobs(
        apps.map((a: Record<string, unknown>) => ({
          n: String(a.n ?? ""),
          company: String(a.company ?? ""),
          role: String(a.role ?? ""),
          status: String(a.status ?? ""),
          score: typeof a.score === "number" ? a.score : undefined,
        })),
      );
    } catch {
      setJobs([]);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const loadCvVersions = useCallback(async () => {
    setCvVersions([]);
    if (!jobId) return;
    try {
      const res = await fetch(`/api/cv/tailor/${encodeURIComponent(jobId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { sessions?: Array<{ id?: string; label?: string; jobTitle?: string; updatedAt?: string }> };
      const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
      setCvVersions(
        sessions.map((s) => ({
          id: String(s.id ?? ""),
          label: `${String(s.label ?? s.jobTitle ?? "Anpassat CV")} (${String(s.updatedAt ?? "").slice(0, 10)})`,
        })),
      );
    } catch {
      setCvVersions([]);
    }
  }, [jobId]);

  useEffect(() => {
    loadCvVersions();
  }, [loadCvVersions]);

  const selectedJob = useMemo(() => jobs.find((j) => j.n === jobId) || null, [jobs, jobId]);

  const generate = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await postJson("/api/application-studio/generate", {
        jobId,
        cvVersionId: cvVersionId || undefined,
        settings: { length, style, language },
      });
      if (!data.ok) throw new Error(data.error || "generering misslyckades");
      setPkg(data.package);
      setNotice(`Paket ${data.package?.packageId} skapat — alla fakta verifierade mot din profil.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const mutate = async (action: string, body: Record<string, unknown>) => {
    if (!pkg) return;
    setError("");
    try {
      const data = await patchJson(`/api/application-studio/${pkg.packageId}`, { action, ...body });
      if (!data.ok) throw new Error(data.error || "åtgärd misslyckades");
      setPkg(data.package);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const regenerate = async (messageId: string) => {
    if (!pkg) return;
    setError("");
    try {
      const data = await postJson(`/api/application-studio/${pkg.packageId}/regenerate`, {
        messageId,
        settings: { length, style, language },
      });
      if (!data.ok) throw new Error(data.error || "regenerering misslyckades");
      setPkg(data.package);
      setNotice("Meddelandet regenererades och faktakontrollerades.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const changePipeline = async (status: string) => {
    if (!pkg) return;
    setError("");
    try {
      const data = await patchJson(`/api/application-studio/${pkg.packageId}/pipeline`, { status });
      if (!data.ok) throw new Error(data.error || "statusändring misslyckades");
      setPkg(data.package);
      setNotice(`Status → ${status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("Kunde inte kopiera — testa att markera texten manuellt.");
    }
  };

  const stepIndex = useMemo(() => {
    if (!pkg) return 0;
    const hasMessages = pkg.messages.length > 0;
    const ready = pkg.status === "Ready to Apply";
    if (ready) return FLOW_STEPS.length - 1;
    if (hasMessages) return 6;
    if (jobId) return 3;
    return 0;
  }, [pkg, jobId]);

  const draftCount = pkg ? pkg.messages.filter((m) => m.draft).length : 0;
  const doneCount = pkg ? pkg.messages.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Ansökningsstudio</h1>
          <p className="text-sm text-muted-foreground">
            Skapa ansökningsmaterial från <strong>verifierade fakta</strong> — AI hittar aldrig på erfarenheter, resultat eller kompetenser.
          </p>
        </div>
        <Badge tone="muted">FAS 5 — Ingen e-post skickas automatiskt</Badge>
      </div>

      {/* Flow steps */}
      <Card className="p-4">
        <ol className="flex flex-wrap items-center gap-1 text-[11px] font-medium">
          {FLOW_STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-1">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5",
                  i < stepIndex ? "bg-emerald-600/15 text-emerald-700" : i === stepIndex ? "bg-primary/15 text-primary" : "text-muted-foreground",
                )}
              >
                {i + 1}. {step}
              </span>
              {i < FLOW_STEPS.length - 1 && <span className="text-muted-foreground/50">→</span>}
            </li>
          ))}
        </ol>
      </Card>

      {/* Job + settings */}
      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Valt jobb</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              <option value="">— Välj ett jobb från pipelinen —</option>
              {jobs.map((j) => (
                <option key={j.n} value={j.n}>
                  {j.role} @ {j.company} ({j.status})
                </option>
              ))}
            </select>
            {selectedJob && (
              <p className="text-xs text-muted-foreground">
                Match: {typeof selectedJob.score === "number" ? `${selectedJob.score}%` : "ej analyserad"} · {selectedJob.status}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Anpassad CV-version (valfri)</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={cvVersionId}
              onChange={(e) => setCvVersionId(e.target.value)}
            >
              <option value="">— Original-CV —</option>
              {cvVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Längd</label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={length} onChange={(e) => setLength(e.target.value)}>
              {LENGTH_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Stil</label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={style} onChange={(e) => setStyle(e.target.value)}>
              {STYLE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Språk</label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={generate} disabled={!jobId || loading}>
            {loading ? "Genererar…" : pkg ? "Generera om alla meddelanden" : "Skapa ansökningspaket"}
          </Button>
          {pkg && (
            <Button
              variant="outline"
              onClick={() => changePipeline(pkg.status === "Ready to Apply" ? "Applied" : "Ready to Apply")}
            >
              {pkg.status === "Ready to Apply" ? "Markera som Applied" : "Markera som READY TO APPLY"}
            </Button>
          )}
        </div>
      </Card>

      {error && <Card className="border-red-500/40 bg-red-50 p-4 text-sm text-red-700">{error}</Card>}
      {notice && <Card className="border-emerald-500/40 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</Card>}

      {/* Pipeline status */}
      {pkg && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-sm font-medium">Status: </span>
              <Badge>{pkg.status}</Badge>
              <span className="ml-3 text-xs text-muted-foreground">
                {doneCount} meddelanden · {draftCount} utkast · {pkg.history.filter((h) => h.event === "status-change").length} statusändringar
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => changePipeline("Preparing")}>
                Preparing
              </Button>
              <Button variant="outline" size="sm" onClick={() => changePipeline("Applied")}>
                Applied
              </Button>
              <Button variant="outline" size="sm" onClick={() => changePipeline("Interview")}>
                Interview
              </Button>
            </div>
          </div>
          {pkg.history.filter((h) => h.event === "status-change").length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {pkg.history
                .filter((h) => h.event === "status-change")
                .slice(-5)
                .reverse()
                .map((h, i) => (
                  <li key={i}>
                    {h.at.slice(0, 16)} — {h.from ?? "–"} → {h.to ?? h.status}
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}

      {/* Messages */}
      {pkg && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Meddelanden ({pkg.messages.length})</h2>
          {pkg.messages.map((m) => (
            <Card key={m.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{m.title}</span>
                  {m.draft && <Badge tone="warn">Utkast</Badge>}
                  <Badge tone="muted">
                    v{m.version}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {m.settings.length} · {m.settings.style} · {m.settings.language}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setEditing(editing?.id === m.id ? null : { id: m.id, body: m.body })}>
                    {editing?.id === m.id ? "Avbryt" : "Redigera"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => regenerate(m.id)}>
                    Regenerera
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => copyText(m.subject ? `${m.subject}\n\n${m.body}` : m.body, m.id)}>
                    {copied === m.id ? "Kopierad!" : "Kopiera"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => mutate("set-draft", { messageId: m.id, draft: !m.draft })}>
                    {m.draft ? "Färdigställ" : "Spara som utkast"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpandedFacts(expandedFacts === m.id ? "" : m.id)}
                  >
                    Fakta ({m.factsUsed.length})
                  </Button>
                </div>
              </div>

              {m.subject && (
                <p className="mt-2 text-sm font-medium text-muted-foreground">Ämne: {m.subject}</p>
              )}

              {editing?.id === m.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="min-h-[140px] w-full rounded-md border bg-background p-3 font-mono text-xs"
                    value={editing.body}
                    onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => mutate("edit-message", { messageId: m.id, body: editing.body })}>
                      Spara ändring (ny version)
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Avbryt
                    </Button>
                  </div>
                </div>
              ) : (
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-relaxed">{m.body}</pre>
              )}

              {/* Versionshistorik */}
              {m.versions.length > 1 && (
                <div className="mt-3">
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">Versionshistorik ({m.versions.length})</summary>
                    <ul className="mt-2 space-y-1 text-xs">
                      {[...m.versions].reverse().map((v) => (
                        <li key={v.version} className="flex items-center gap-2">
                          <span className="font-mono">v{v.version}</span>
                          <span className="text-muted-foreground">{v.editedAt.slice(0, 16)} ({v.by})</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => mutate("restore-version", { messageId: m.id, version: v.version })}
                          >
                            Återställ
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}

              {/* Fakta som användes */}
              {expandedFacts === m.id && (
                <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-50/60 p-3">
                  <p className="text-xs font-semibold text-emerald-800">Verifierade fakta som användes</p>
                  <ul className="mt-1.5 grid gap-1 text-xs text-emerald-900 sm:grid-cols-2">
                    {m.factsUsed.map((f, i) => (
                      <li key={i}>
                        <span className="font-medium">{f.label}:</span> {f.value}{" "}
                        <span className="text-emerald-600/70">({f.source})</span>
                      </li>
                    ))}
                  </ul>
                  {m.missingFacts.length > 0 && (
                    <>
                      <p className="mt-2 text-xs font-semibold text-amber-700">Kräver din input (AI fyller inte i):</p>
                      <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
                        {m.missingFacts.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
