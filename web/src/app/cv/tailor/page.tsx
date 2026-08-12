"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface JobRow {
  id: string;
  jobTitle: string;
  company: string | null;
  location: string | null;
  analyzedAt: string | null;
}

interface SessionRow {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  level: string;
  model: string;
  status: string;
  createdAt: string;
  totalChanges: number;
}

export default function CvTailorOverviewPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [jr, sr] = await Promise.all([
          fetch("/api/jobs/intelligence"),
          fetch("/api/cv/tailor"),
        ]);
        if (jr.ok) {
          const d = await jr.json();
          setJobs((d.analyses || []).filter((a: JobRow) => a.analyzedAt));
        }
        if (sr.ok) {
          const d = await sr.json();
          setSessions(d.sessions || []);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--fg)]">CV-anpassning</h1>
        <p className="text-sm text-[var(--muted)]">
          Välj ett analyserat jobb och skapa en jobbanpassad CV-version med AI-stöd och
          ändringsgranskning. Original-CV:t ändras aldrig.
        </p>
      </div>

      {loading && <p className="text-sm text-[var(--muted)]">Laddar…</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Analyserade jobb */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">
            Analyserade jobb
          </h2>
          {jobs.length === 0 ? (
            <Card className="p-4 text-sm text-[var(--muted)]">
              Inga analyserade jobb ännu. Analysera ett jobb under Jobbintelligens först.
            </Card>
          ) : (
            <ul className="space-y-2">
              {jobs.map((j) => (
                <Card key={j.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--fg)]">{j.jobTitle}</p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {[j.company, j.location].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => router.push(`/cv/tailor/${j.id}`)}>
                    Anpassa CV
                  </Button>
                </Card>
              ))}
            </ul>
          )}
        </section>

        {/* Tidigare anpassningar */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">
            Tidigare anpassningar
          </h2>
          {sessions.length === 0 ? (
            <Card className="p-4 text-sm text-[var(--muted)]">
              Inga anpassningar ännu. Börja med ett jobb ovan.
            </Card>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <Card
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--fg)]">{s.jobTitle}</p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {s.company || "—"} · {s.totalChanges} ändringar · {s.model}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={s.status === "applied" ? "good" : "info"}>
                      {s.status === "applied" ? "Sparad" : "Utkast"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/cv/tailor/${s.jobId}`)}
                    >
                      Fortsätt
                    </Button>
                  </div>
                </Card>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
