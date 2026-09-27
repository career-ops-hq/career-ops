"use client";

import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  Loader2,
  Upload,
  FileText,
  Sparkles,
  Download,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Lock,
  ArrowRight,
  Eye,
  Edit3,
  Sliders,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { cvReadiness } from "@/lib/cv/quality";
import { CvIngest } from "@/components/cv/cv-ingest";

type Tab = "editor" | "upload" | "profile" | "audit";

export function CvEditor() {
  const [tab, setTab] = useState<Tab>("editor");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceErr, setEnhanceErr] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchCv = async () => {
    try {
      const r = await fetch("/api/cv");
      const d = await r.json();
      setContent(d.content ?? "");
      setExists(d.exists ?? false);
      if (!d.content) {
        setTab("upload");
      }
    } catch {}
    finally {
      setLoaded(true);
    }
  };

  const fetchProfile = async () => {
    try {
      const r = await fetch("/api/profile");
      const d = await r.json();
      if (d.profile) setProfile(d.profile);
    } catch {}
  };

  useEffect(() => {
    fetchCv();
    fetchProfile();
  }, []);

  const readiness = content ? cvReadiness(content) : null;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setDirty(false);
        setExists(true);
        setSaved(true);
        fetchProfile();
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  const handleQuickUpload = async (file: File) => {
    setSaving(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/cv/upload", {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        const d = await res.json();
        setContent(d.markdown || "");
        setDirty(false);
        setExists(true);
        setSaved(true);
        fetchProfile();
        setTab("editor");
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {}
    finally {
      setSaving(false);
    }
  };

  const downloadMarkdown = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cv.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const enhanceWithAi = async () => {
    setEnhancing(true);
    setEnhanceErr("");
    try {
      const res = await fetch("/api/cv/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content, cliId: "claude" }),
      });
      if (!res.ok) {
        throw new Error("AI enhancement requires an active AI CLI in Settings/Config.");
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
      }
      const start = full.indexOf("<<cv:start>>");
      const end = full.indexOf("<<cv:end>>");
      if (start !== -1 && end !== -1) {
        const enhanced = full.slice(start + "<<cv:start>>".length, end).trim();
        setContent(enhanced);
        setDirty(true);
      }
    } catch (e) {
      setEnhanceErr(e instanceof Error ? e.message : "AI enhancement failed");
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <FileText className="size-6 text-brand" />
            <h1 className="text-2xl font-bold text-foreground">Master CV &amp; Profile</h1>
            <span className="rounded-md border border-brand/30 bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">
              cv.md
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            The canonical source of truth for your experience, achievements, and targeting. Synced with <code className="font-mono text-foreground font-semibold">config/profile.yml</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.md,.txt"
            hidden
            onChange={(e) => e.target.files?.[0] && handleQuickUpload(e.target.files[0])}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-surface-hover shadow-sm"
          >
            <Upload className="size-3.5 text-brand" />
            Upload PDF / Resume
          </button>

          <button
            type="button"
            onClick={downloadMarkdown}
            disabled={!content.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-surface-hover shadow-sm disabled:opacity-50"
          >
            <Download className="size-3.5" />
            Export .md
          </button>

          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold shadow-sm transition-colors",
              dirty
                ? "bg-brand text-white hover:bg-brand-200"
                : "border border-border bg-surface text-muted cursor-not-allowed opacity-60"
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
            {saved ? "Saved to cv.md" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-border pb-1">
        <button
          onClick={() => setTab("editor")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors",
            tab === "editor"
              ? "bg-brand-soft text-brand border border-brand/30"
              : "text-muted hover:text-foreground hover:bg-surface"
          )}
        >
          <Edit3 className="size-3.5" />
          Editor &amp; Live Preview
        </button>

        <button
          onClick={() => setTab("upload")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors",
            tab === "upload"
              ? "bg-brand-soft text-brand border border-brand/30"
              : "text-muted hover:text-foreground hover:bg-surface"
          )}
        >
          <Upload className="size-3.5" />
          Upload &amp; AI Ingest
        </button>

        <button
          onClick={() => setTab("profile")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors",
            tab === "profile"
              ? "bg-brand-soft text-brand border border-brand/30"
              : "text-muted hover:text-foreground hover:bg-surface"
          )}
        >
          <Sliders className="size-3.5" />
          Target Roles &amp; Profile Sync
        </button>

        <button
          onClick={() => setTab("audit")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors",
            tab === "audit"
              ? "bg-brand-soft text-brand border border-brand/30"
              : "text-muted hover:text-foreground hover:bg-surface"
          )}
        >
          <ShieldCheck className="size-3.5" />
          Readiness &amp; Audit
        </button>
      </div>

      {/* Tab 1: Editor & Preview */}
      {tab === "editor" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-surface/50 border border-border px-4 py-2.5 rounded-xl text-xs">
            <div className="flex items-center gap-3">
              {readiness && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    readiness.scoreable
                      ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  )}
                >
                  {readiness.scoreable ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                  {readiness.scoreable ? "Ready for Job Scoring" : "A bit brief"}
                </span>
              )}
              <span className="text-muted">
                Words: <strong className="text-foreground">{readiness?.words || 0}</strong>
              </span>
            </div>

            <button
              onClick={enhanceWithAi}
              disabled={enhancing || !content.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20 disabled:opacity-50"
            >
              {enhancing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              {enhancing ? "Enhancing..." : "Enhance with AI"}
            </button>
          </div>

          {enhanceErr && (
            <div className="text-xs text-amber-400 bg-amber-950/20 border border-amber-500/20 p-3 rounded-lg flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{enhanceErr}</span>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-muted px-1">
                <span>Markdown Source (cv.md)</span>
                {dirty && <span className="text-amber-400">Unsaved changes</span>}
              </div>
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
                placeholder="# CV -- Your Name&#10;&#10;**Location:** Austin, TX&#10;**Email:** alex@example.com&#10;&#10;## Professional Summary&#10;..."
                className="min-h-[65vh] w-full resize-none rounded-2xl border border-border bg-surface/50 p-4 font-mono text-xs leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-brand/40 text-foreground"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted px-1">Live Document Preview</div>
              <article className="prose prose-sm dark:prose-invert min-h-[65vh] max-h-[65vh] overflow-y-auto rounded-2xl border border-border bg-surface/30 p-5">
                {content.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                ) : (
                  <p className="text-muted">Preview appears here as you write or upload.</p>
                )}
              </article>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Upload & AI Ingest */}
      {tab === "upload" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted">
            <strong className="text-foreground">Upload or Paste Resume:</strong> Drop any PDF, Word (.docx), or Markdown file to automatically extract your contact info, skills, work experience, and target roles directly into <code className="text-foreground font-mono">cv.md</code> and <code className="text-foreground font-mono">config/profile.yml</code>.
          </div>
          <CvIngest
            onSaved={() => {
              fetchCv();
              fetchProfile();
              setTab("editor");
            }}
          />
        </div>
      )}

      {/* Tab 3: Target Roles & Profile Sync */}
      {tab === "profile" && (
        <div className="rounded-2xl border border-border bg-surface/40 p-6 space-y-6">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
              Synchronized Profile Intelligence
            </h2>
            <p className="mt-1 text-xs text-faint">
              Derived automatically from your CV and stored in <code className="font-mono text-foreground font-semibold">config/profile.yml</code>.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
              <div className="text-xs font-semibold text-muted uppercase">Candidate Contact</div>
              <div className="text-sm font-bold text-foreground">{profile?.candidate?.full_name || "—"}</div>
              <div className="text-xs text-brand font-medium">{profile?.candidate?.title || "—"}</div>
              <div className="text-xs text-muted">{profile?.candidate?.email || "—"} · {profile?.candidate?.location || "—"}</div>
              <div className="text-xs text-faint truncate">{profile?.candidate?.linkedin || profile?.candidate?.github || "—"}</div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
              <div className="text-xs font-semibold text-muted uppercase">Target Roles &amp; Compensation</div>
              <div className="flex flex-wrap gap-1.5">
                {(profile?.target_roles?.primary || ["Software Engineer"]).map((role: string, i: number) => (
                  <span key={i} className="rounded-md bg-surface-hover border border-border px-2 py-0.5 text-xs text-foreground font-medium">
                    {role}
                  </span>
                ))}
              </div>
              <div className="pt-2 text-xs text-emerald-400 font-semibold">
                Target Comp: {profile?.compensation?.target_range || "$150K-$190K"} ({profile?.compensation?.currency || "USD"})
              </div>
              <div className="text-xs text-muted">
                Flexibility: {profile?.compensation?.location_flexibility || "Remote preferred"}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-xs text-faint">To customize these fields in detail, visit Settings &gt; Profile</span>
            <button
              onClick={() => setTab("editor")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-200"
            >
              Back to CV Editor <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Tab 4: Readiness & Audit */}
      {tab === "audit" && (
        <div className="rounded-2xl border border-border bg-surface/40 p-6 space-y-6">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
              ATS &amp; Evaluation Readiness Audit
            </h2>
            <p className="mt-1 text-xs text-faint">
              Deterministic quality checks before running scanner matches and job evaluations.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4 flex items-start gap-3">
              <CheckCircle2 className="size-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-foreground">Word Count &amp; Depth</div>
                <div className="text-xs text-muted mt-0.5">
                  {readiness?.words || 0} words parsed ({readiness?.words && readiness.words >= 80 ? "Passes minimum threshold" : "Needs more detail"}).
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-4 flex items-start gap-3">
              <CheckCircle2 className="size-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-foreground">Work Experience Sections</div>
                <div className="text-xs text-muted mt-0.5">
                  {readiness?.hasExperience ? "Detected structured employment history" : "Add ## Work Experience section"}.
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-4 flex items-start gap-3">
              <CheckCircle2 className="size-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-foreground">Skills Taxonomy</div>
                <div className="text-xs text-muted mt-0.5">
                  {readiness?.hasSkills ? "Detected core skills and technologies" : "Add ## Skills section"}.
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-4 flex items-start gap-3">
              <CheckCircle2 className="size-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-foreground">Local Storage &amp; Encryption</div>
                <div className="text-xs text-muted mt-0.5">
                  Stored 100% locally in workspace root (cv.md + config/profile.yml).
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

