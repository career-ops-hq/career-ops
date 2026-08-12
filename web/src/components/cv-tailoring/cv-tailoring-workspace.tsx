"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { CvExportWorkspace } from "@/components/cv-tailoring/cv-export-workspace";

/* ── Types ──────────────────────────────────────────────────────────── */

export type TailorLevel = "light" | "professional" | "targeted";

interface TailorChange {
  id: string;
  sectionId: string;
  type: "added" | "removed" | "rephrased" | "moved" | "keyword" | "needsVerification";
  original?: string;
  proposed?: string;
  reason: string;
  verified: boolean;
  keyword?: string;
}

interface TailorSection {
  id: string;
  type: string;
  title: string;
  original: string;
  proposed: string;
  changes: TailorChange[];
}

interface TailorSession {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  level: TailorLevel;
  model: string;
  status: "draft" | "applied";
  createdAt: string;
  updatedAt: string;
  sections: TailorSection[];
  originalCv: string;
  proposedCv: string;
  approvedIds: string[];
  rejectedIds: string[];
  edits: Record<string, string>;
  version: { id: string; label: string; createdAt: string } | null;
  appliedAt: string | null;
}

const LEVELS: Array<{ key: TailorLevel; label: string; description: string }> = [
  {
    key: "light",
    label: "LIGHT",
    description: "Små språkförbättringar, relevanta nyckelord, strukturen behålls.",
  },
  {
    key: "professional",
    label: "PROFESSIONAL",
    description: "Bättre sammanfattning, relevant erfarenhet först, ATS-anpassat språk.",
  },
  {
    key: "targeted",
    label: "TARGETED",
    description: "Stark anpassning till jobbet med rollspecifik profil och tydligt relevansfokus.",
  },
];

type BadgeTone = "good" | "bad" | "info" | "warn" | "muted";
const CHANGE_LABEL: Record<TailorChange["type"], { label: string; tone: BadgeTone }> = {
  added: { label: "Tillagd", tone: "good" },
  removed: { label: "Borttagen", tone: "bad" },
  rephrased: { label: "Omformulerad", tone: "info" },
  moved: { label: "Omplacerad", tone: "info" },
  keyword: { label: "Jobbnyckelord", tone: "good" },
  needsVerification: { label: "Behöver verifieras", tone: "warn" },
};

/* ── Workspace ──────────────────────────────────────────────────────── */

export function CvTailoringWorkspace({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<{ jobTitle: string; company: string | null; location: string | null } | null>(null);
  const [session, setSession] = useState<TailorSession | null>(null);
  const [level, setLevel] = useState<TailorLevel>("professional");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saved, setSaved] = useState<{ versionId: string; label: string } | null>(null);
  const [showExport, setShowExport] = useState(false);

  const changeIds = useMemo(
    () => (session ? session.sections.flatMap((s) => s.changes.map((c) => c.id)) : []),
    [session],
  );

  const loadJob = useCallback(async () => {
    try {
      const r = await fetch(`/api/jobs/intelligence/${jobId}`);
      if (!r.ok) return;
      const d = await r.json();
      setJob({
        jobTitle: d.analysis?.metadata?.jobTitle || "Jobb",
        company: d.analysis?.metadata?.company || null,
        location: d.analysis?.metadata?.location || null,
      });
    } catch {
      /* ignore */
    }
  }, [jobId]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  async function createProposal() {
    setBusy(true);
    setError("");
    setSaved(null);
    try {
      const r = await fetch("/api/cv/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, level }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Kunde inte skapa förslag");
      const s = d.session as TailorSession;
      setSession(s);
      setApproved(new Set(s.approvedIds));
      setRejected(new Set(s.rejectedIds));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Något gick fel");
    } finally {
      setBusy(false);
    }
  }

  async function persist(next: TailorSession) {
    const r = await fetch(`/api/cv/tailor/${next.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvedIds: [...approved],
        rejectedIds: [...rejected],
        edits: next.edits,
      }),
    });
    if (r.ok) {
      const d = await r.json();
      if (d.session) setSession(d.session);
    }
  }

  function approve(id: string) {
    setApproved((prev) => new Set(prev).add(id));
    setRejected((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  }

  function reject(id: string) {
    setRejected((prev) => new Set(prev).add(id));
    setApproved((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  }

  function approveAllSafe() {
    if (!session) return;
    const safe = session.sections.flatMap((s) =>
      s.changes.filter((c) => c.verified && !rejected.has(c.id)).map((c) => c.id),
    );
    setApproved((prev) => new Set([...prev, ...safe]));
  }

  function resetAll() {
    setApproved(new Set());
    setRejected(new Set());
  }

  async function applyVersion() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/cv/tailor/${session.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedIds: [...approved], edits: session.edits }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Kunde inte spara version");
      setSaved({ versionId: d.version.id, label: d.version.label });
      if (d.session) {
        setSession(d.session);
        setApproved(new Set(d.session.approvedIds));
        setRejected(new Set(d.session.rejectedIds));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Något gick fel");
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => {
    if (!session) return null;
    const total = session.sections.reduce((n, s) => n + s.changes.length, 0);
    const verified = session.sections.reduce(
      (n, s) => n + s.changes.filter((c) => c.verified).length,
      0,
    );
    return { total, verified, needsVerification: total - verified };
  }, [session]);

  /* ── Render ───────────────────────────────────────────────────────── */

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--fg)]">CV-anpassning</h1>
          <p className="text-sm text-[var(--muted)]">
            {job
              ? `${job.jobTitle}${job.company ? ` · ${job.company}` : ""}`
              : "Laddar jobbanalys…"}
          </p>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-2">
            <Badge tone="muted">{summary.total} ändringar</Badge>
            <Badge tone="good">{summary.verified} verifierade</Badge>
            {summary.needsVerification > 0 && (
              <Badge tone="warn">{summary.needsVerification} behöver verifieras</Badge>
            )}
            <Badge tone="info">{session?.model || "deterministic"}</Badge>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {saved && (
        <div className="mb-4 space-y-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--good)]/10 px-3 py-2 text-sm text-[var(--fg)]">
            ✅ Ny CV-version sparad: <strong>{saved.label}</strong> (version {saved.versionId.slice(0, 8)}).
            Original-CV:t är oförändrat. Versionen finns i CV-studio under Versionshistorik.
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowExport(!showExport)}>
            {showExport ? "Dölj ATS & Export" : "ATS & Export →"}
          </Button>
        </div>
      )}

      {showExport && saved && session && (
        <CvExportWorkspace
          cvText={session.proposedCv}
          jobId={jobId}
          versionId={saved.versionId}
          jobTitle={job?.jobTitle ?? undefined}
          company={job?.company ?? undefined}
        />
      )}

      {/* ── Steg 1: Nivåval ── */}
      {!session && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold text-[var(--fg)]">Välj anpassningsnivå</p>
          <div className="grid gap-3 md:grid-cols-3">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setLevel(l.key)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  level === l.key
                    ? "border-[var(--brand)] bg-[var(--brand)]/5"
                    : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                )}
              >
                <p className="text-sm font-semibold tracking-wide text-[var(--brand)]">{l.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{l.description}</p>
              </button>
            ))}
          </div>
          <div className="mt-4">
            <Button onClick={createProposal} disabled={busy}>
              {busy ? "Skapar förslag…" : "Skapa AI-förslag"}
            </Button>
          </div>
        </Card>
      )}

      {/* ── Steg 2–3: Granskning ── */}
      {session && (
        <div className="space-y-4">
          {/* Verktygsrad */}
          <Card className="flex flex-wrap items-center gap-2 p-3">
            <Button variant="outline" onClick={approveAllSafe}>
              Godkänn alla säkra
            </Button>
            <Button variant="outline" onClick={resetAll}>
              Återställ
            </Button>
            <div className="flex-1" />
            <Button onClick={() => setSession(null)} variant="ghost">
              Ny nivå
            </Button>
            <Button onClick={applyVersion} disabled={busy || approved.size === 0}>
              {busy ? "Sparar…" : "Spara som ny version"}
            </Button>
          </Card>

          {/* Före/Efter per sektion */}
          {session.sections.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--fg)]">
                  {s.title || s.id}
                  {s.changes.length > 0 && (
                    <Badge tone="muted" className="ml-2">{s.changes.length} ändringar</Badge>
                  )}
                </p>
                {editing === s.id && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(null);
                      setEditText("");
                    }}
                  >
                    Klar
                  </Button>
                )}
              </div>

              {/* Ändringslista */}
              {s.changes.length > 0 ? (
                <ul className="mb-3 space-y-2">
                  {s.changes.map((c) => {
                    const meta = CHANGE_LABEL[c.type];
                    const isApproved = approved.has(c.id);
                    const isRejected = rejected.has(c.id);
                    return (
                      <li
                        key={c.id}
                        className={cn(
                          "rounded-lg border p-2.5",
                          isApproved
                            ? "border-[var(--good)]/60 bg-[var(--good)]/5"
                            : isRejected
                              ? "border-[var(--danger)]/60 bg-[var(--danger)]/5 opacity-60"
                              : "border-[var(--border)]",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={meta.tone}>{meta.label}</Badge>
                              {c.verified ? (
                                <Badge tone="good">Verifierad</Badge>
                              ) : (
                                <Badge tone="warn">Behöver verifieras</Badge>
                              )}
                            </div>
                            {c.original !== undefined && c.original !== c.proposed && (
                              <p className="mt-1.5 text-sm text-[var(--muted)] line-through">
                                {c.original}
                              </p>
                            )}
                            {c.proposed !== undefined && (
                              <p className="mt-1 text-sm text-[var(--fg)]">{c.proposed}</p>
                            )}
                            {c.type === "moved" && c.original && c.proposed && (
                              <p className="mt-1 text-xs text-[var(--muted)]">
                                Flyttas från: {c.original}
                              </p>
                            )}
                            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                              {c.reason}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <Button
                              size="sm"
                              variant={isApproved ? "primary" : "outline"}
                              onClick={() => approve(c.id)}
                            >
                              {isApproved ? "Godkänd" : "Godkänn"}
                            </Button>
                            <Button
                              size="sm"
                              variant={isRejected ? "secondary" : "outline"}
                              onClick={() => reject(c.id)}
                            >
                              {isRejected ? "Avvisad" : "Avvisa"}
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mb-3 text-sm text-[var(--muted)]">Inga ändringar föreslagna.</p>
              )}

              {/* Före/Efter-paneler */}
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">
                    Original
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--fg)]">
                    {s.original}
                  </pre>
                </div>
                <div className="rounded-lg border border-[var(--brand)]/40 bg-[var(--surface)] p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--brand)]">
                    Föreslagen
                  </p>
                  {editing === s.id ? (
                    <div>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={Math.max(4, s.proposed.split("\n").length)}
                        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs text-[var(--fg)] outline-none focus:border-[var(--brand)]"
                      />
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          onClick={async () => {
                            if (!session) return;
                            const next = {
                              ...session,
                              edits: { ...session.edits, [s.id]: editText },
                            };
                            setSession(next);
                            setEditing(null);
                            setEditText("");
                            await persist(next);
                          }}
                        >
                          Spara redigering
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Avbryt
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--fg)]">
                      {s.proposed}
                    </pre>
                  )}
                </div>
              </div>
              {!editing && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(s.id);
                      setEditText(s.proposed);
                    }}
                  >
                    Redigera föreslagen text
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
