"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RotateCcw, ShieldCheck, Target } from "lucide-react";

import { CvEditor } from "@/components/cv-editor";
import { CvIngest } from "@/components/cv/cv-ingest";

type Profile = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  portfolio: string;
  headline: string;
  summary: string;
  targetRoles: string[];
  skills: string[];
  workModes: string[];
};

type CvVersion = {
  id: string;
  createdAt: string;
  label: string;
  source: string;
  bytes: number;
};

type AtsResult = {
  score: number;
  keywordMatch: { matched: string[]; missing: string[] };
  recommendations: string[];
};

const EMPTY_PROFILE: Profile = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  portfolio: "",
  headline: "",
  summary: "",
  targetRoles: [],
  skills: [],
  workModes: [],
};

function splitTags(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function Field({ label, value, onChange, type = "text" }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-[var(--fg)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-orange-500"
      />
    </label>
  );
}

export function CareerFoundation() {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [versions, setVersions] = useState<CvVersion[]>([]);
  const [restoring, setRestoring] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [ats, setAts] = useState<AtsResult | null>(null);
  const [atsLoading, setAtsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadVersions = useCallback(async () => {
    const response = await fetch("/api/cv/versions", { cache: "no-store" });
    if (!response.ok) throw new Error("Kunde inte läsa CV-versioner.");
    const data = await response.json();
    setVersions(data.versions ?? []);
  }, []);

  const analyze = useCallback(async (description: string) => {
    setAtsLoading(true);
    try {
      const response = await fetch("/api/ats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription: description }),
      });
      if (!response.ok) throw new Error("ATS-analysen misslyckades.");
      setAts(await response.json());
    } finally {
      setAtsLoading(false);
    }
  }, []);

  const refreshCvData = useCallback(() => {
    setError("");
    void Promise.all([loadVersions(), analyze("")]).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Kunde inte uppdatera CV-data.");
    });
  }, [analyze, loadVersions]);

  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Kunde inte läsa masterprofilen.");
        return response.json();
      })
      .then((data) => setProfile({ ...EMPTY_PROFILE, ...(data.profile ?? {}) }))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Profilfel"))
      .finally(() => setProfileLoading(false));
    refreshCvData();
    window.addEventListener("career:cv-updated", refreshCvData);
    return () => window.removeEventListener("career:cv-updated", refreshCvData);
  }, [refreshCvData]);

  async function saveProfile() {
    setProfileSaving(true);
    setProfileSaved(false);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Kunde inte spara masterprofilen.");
      setProfile(data.profile);
      setProfileSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profilfel");
    } finally {
      setProfileSaving(false);
    }
  }

  async function restoreVersion(id: string) {
    setRestoring(id);
    setError("");
    try {
      const response = await fetch("/api/cv/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Återställningen misslyckades.");
      window.dispatchEvent(new Event("career:cv-updated"));
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Återställningsfel");
      setRestoring("");
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-8">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">Karriärgrund</p>
        <h1 className="text-3xl font-semibold text-[var(--fg)]">Career Master Profile & CV</h1>
        <p className="max-w-3xl text-sm text-[var(--muted)]">En gemensam profil, versionshanterat CV och lokal ATS-kontroll. Inget skickas till arbetsgivare utan ditt godkännande.</p>
      </header>

      {error ? <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-700">{error}</div> : null}

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div><h2 className="text-xl font-semibold">Career Master Profile</h2><p className="text-sm text-[var(--muted)]">Källan för framtida matchning, CV-varianter och ansökningar.</p></div>
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><ShieldCheck size={15} /> Privat, atomisk lagring</span>
        </div>
        {profileLoading ? <Loader2 className="animate-spin" /> : (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Namn" value={profile.fullName} onChange={(value) => setProfile({ ...profile, fullName: value })} />
            <Field label="E-post" type="email" value={profile.email} onChange={(value) => setProfile({ ...profile, email: value })} />
            <Field label="Telefon" value={profile.phone} onChange={(value) => setProfile({ ...profile, phone: value })} />
            <Field label="Plats" value={profile.location} onChange={(value) => setProfile({ ...profile, location: value })} />
            <Field label="LinkedIn" value={profile.linkedin} onChange={(value) => setProfile({ ...profile, linkedin: value })} />
            <Field label="Portfolio" value={profile.portfolio} onChange={(value) => setProfile({ ...profile, portfolio: value })} />
            <div className="md:col-span-2"><Field label="Professionell rubrik" value={profile.headline} onChange={(value) => setProfile({ ...profile, headline: value })} /></div>
            <div className="md:col-span-2"><Field label="Målroller (kommaseparerade)" value={profile.targetRoles.join(", ")} onChange={(value) => setProfile({ ...profile, targetRoles: splitTags(value) })} /></div>
            <div className="md:col-span-2"><Field label="Nyckelkompetenser (kommaseparerade)" value={profile.skills.join(", ")} onChange={(value) => setProfile({ ...profile, skills: splitTags(value) })} /></div>
            <label className="grid gap-1 text-sm md:col-span-2"><span className="font-medium">Sammanfattning</span><textarea rows={5} value={profile.summary} onChange={(event) => setProfile({ ...profile, summary: event.target.value })} className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-orange-500" /></label>
            <div className="md:col-span-2 flex justify-end"><button onClick={saveProfile} disabled={profileSaving} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{profileSaving ? <Loader2 size={16} className="animate-spin" /> : profileSaved ? <Check size={16} /> : null}{profileSaved ? "Sparad" : "Spara masterprofil"}</button></div>
          </div>
        )}
      </section>

      <section className="grid gap-4"><h2 className="text-xl font-semibold">Importera CV</h2><CvIngest onSaved={refreshCvData} /></section>
      <CvEditor />

      <section className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
        <div><h2 className="text-xl font-semibold">CV-versioner</h2><p className="text-sm text-[var(--muted)]">Varje bekräftad import, redigering och återställning skapar en ny oföränderlig version.</p></div>
        {versions.length === 0 ? <p className="text-sm text-[var(--muted)]">Inga versioner ännu.</p> : (
          <ul className="divide-y divide-[var(--line)]">{versions.map((version) => <li key={version.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{version.label}</p><p className="text-xs text-[var(--muted)]">{new Date(version.createdAt).toLocaleString("sv-SE")} · {Math.ceil(version.bytes / 1024)} KB · {version.source}</p></div><button onClick={() => restoreVersion(version.id)} disabled={restoring === version.id} className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium disabled:opacity-60">{restoring === version.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Återställ</button></li>)}</ul>
        )}
      </section>

      <section className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
        <div className="flex items-center gap-2"><Target size={20} className="text-orange-600" /><h2 className="text-xl font-semibold">ATS-grund</h2></div>
        <textarea rows={7} value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="Klistra in en jobbannons för nyckelordsmatchning…" className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-orange-500" />
        <button onClick={() => void analyze(jobDescription)} disabled={atsLoading} className="w-fit rounded-lg bg-[var(--fg)] px-4 py-2 text-sm font-semibold text-[var(--bg)] disabled:opacity-60">{atsLoading ? "Analyserar…" : "Analysera mot ATS"}</button>
        {ats ? <div className="grid gap-3 md:grid-cols-[120px_1fr]"><div className="grid place-items-center rounded-xl border border-[var(--line)] p-4"><strong className="text-3xl text-orange-600">{ats.score}</strong><span className="text-xs text-[var(--muted)]">av 100</span></div><div className="grid gap-2 text-sm"><p><strong>Matchade:</strong> {ats.keywordMatch.matched.join(", ") || "—"}</p><p><strong>Saknas:</strong> {ats.keywordMatch.missing.slice(0, 12).join(", ") || "—"}</p>{ats.recommendations.map((item) => <p key={item}>• {item}</p>)}</div></div> : null}
      </section>
    </main>
  );
}
