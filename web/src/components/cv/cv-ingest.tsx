"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Upload, FileText, Loader2, Check, AlertTriangle, Lock, ArrowRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";
import { cvReadiness, parseCvStream, type CvSeed } from "@/lib/cv/quality";
import { DEFAULT_FILTERS, filtersToParams } from "@/lib/explore";

type Phase = "input" | "parsing" | "review" | "saving" | "error";

function cliId(): string | null {
  try {
    return JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId || null;
  } catch {
    return null;
  }
}

const STYLE = `
.co-cvdrop{position:relative;border:1.5px dashed color-mix(in srgb, var(--fg) 22%, transparent);border-radius:1rem;transition:border-color .2s,background .2s}
.co-cvdrop[data-over="true"]{border-color:hsl(26 73% 51%);background:hsl(26 73% 51% /.05)}
.co-cvtrace{animation:co-rise .4s ease both}
`;

export function CvIngest({ onSaved }: { onSaved?: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("input");
  const [parseMode, setParseMode] = useState<"fast" | "ai">("fast");
  const [paste, setPaste] = useState("");
  const [over, setOver] = useState(false);
  const [trace, setTrace] = useState("");
  const [md, setMd] = useState("");
  const [seed, setSeed] = useState<CvSeed | null>(null);
  const [err, setErr] = useState("");
  const [aiEnhancing, setAiEnhancing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readiness = md ? cvReadiness(md) : null;

  // Stream the ingest, parsing markers live.
  const runStream = useCallback(async (init: RequestInit) => {
    setPhase("parsing");
    setTrace("Reading your CV with AI…");
    setErr("");
    try {
      const r = await fetch("/api/cv/ingest", init);
      if (r.status === 404) {
        setErr("Connect an AI CLI in Config first — it parses your CV locally.");
        setPhase("error");
        return;
      }
      if (!r.body) {
        setErr("No response.");
        setPhase("error");
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (; ;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parsed = parseCvStream(buf);
        if (parsed.error) {
          setErr(parsed.error === "unreadable" ? "I couldn't read text from that file (it may be a scanned image). Paste the text instead." : "Couldn't parse the CV — paste the text instead.");
          setPhase("error");
          return;
        }
        if (parsed.trace) {
          const lines = parsed.trace.split("\n").map((l) => l.trim()).filter(Boolean);
          const activeStep = lines.filter((l) => !l.includes("cannot be permission-restricted") && !l.includes("⚠️") && !l.includes("✨")).slice(-1)[0];
          setTrace(activeStep || "AI is structuring your CV…");
        }
        if (parsed.markdown) setMd(parsed.markdown);
        if (parsed.seed) setSeed(parsed.seed);
      }
      const final = parseCvStream(buf);
      if (!final.markdown.trim()) {
        setErr("Couldn't read a CV there — paste the text instead.");
        setPhase("error");
        return;
      }
      setMd(final.markdown);
      setSeed(final.seed);
      setPhase("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "stream error");
      setPhase("error");
    }
  }, []);

  const ingestText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setErr("That looks empty — paste your CV instead.");
      setPhase("error");
      return;
    }
    if (parseMode === "ai") {
      const id = cliId();
      if (!id) {
        setErr("needs-cli");
        setPhase("error");
        return;
      }
      void runStream({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, cliId: id }),
      });
      return;
    }
    // Pasted text is already readable. Same path as a .md/.txt drop — no CLI.
    // Fast path: instant preview
    setSeed(null);
    setMd(trimmed);
    setPhase("review");
  };

  const ingestFile = async (file: File) => {
    if (parseMode === "ai") {
      const id = cliId();
      if (!id) {
        setErr("needs-cli");
        setPhase("error");
        return;
      }
      const form = new FormData();
      form.append("file", file);
      form.append("cliId", id);
      void runStream({ method: "POST", body: form });
      return;
    }

    setPhase("parsing");
    setTrace(`Parsing ${file.name}…`);
    setErr("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/cv/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to process CV file");
      }
      const data = await res.json();
      setMd(data.markdown || "");
      setSeed(data.seed || null);
      setPhase("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read file — paste your CV text instead.");
      setPhase("error");
    }
  };

  const enhanceWithAi = async () => {
    const id = cliId();
    if (!id) {
      setSaveErr("Connect an AI CLI in Config to use AI enhancement.");
      return;
    }
    const currentMd = md;
    setAiEnhancing(true);
    setSaveErr("");
    try {
      const r = await fetch("/api/cv/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: currentMd, cliId: id }),
      });
      if (!r.ok || !r.body) {
        throw new Error("AI enhancement request failed.");
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parsed = parseCvStream(buf);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        if (parsed.markdown) setMd(parsed.markdown);
        if (parsed.seed) setSeed(parsed.seed);
      }
      const final = parseCvStream(buf);
      if (final.markdown.trim()) {
        setMd(final.markdown);
        if (final.seed) setSeed(final.seed);
      } else {
        throw new Error("No enhanced markdown returned.");
      }
    } catch (e) {
      setMd(currentMd);
      setSaveErr(
        e instanceof Error && e.message
          ? `AI enhancement failed: ${e.message}. Keeping current CV text.`
          : "AI enhancement failed. Keeping current CV text."
      );
    } finally {
      setAiEnhancing(false);
    }
  };

  const [saveErr, setSaveErr] = useState("");
  const save = async () => {
    if (!md.trim()) {
      setSaveErr("Your CV looks empty — paste it again.");
      return;
    }
    setSaveErr("");
    setPhase("saving");
    try {
      const r = await fetch("/api/cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: md }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setSaveErr(d.error || "Couldn't save your CV — try again.");
        setPhase("review");
        return;
      }
    } catch {
      setSaveErr("Couldn't save your CV — check your connection and try again.");
      setPhase("review");
      return;
    }
    onSaved?.();
    const roles = seed?.roles?.length ? seed.roles : seed?.title ? [seed.title] : [];
    const f = { ...DEFAULT_FILTERS, ats: [...DEFAULT_FILTERS.ats], positive: roles, sinceDays: 30 };
    const qs = filtersToParams(f);
    router.push(`/explore?${qs}${qs ? "&" : ""}run=1`);
  };

  // ── INPUT ──
  if (phase === "input" || phase === "error") {
    return (
      <div className="space-y-4">
        <style>{STYLE}</style>

        {/* Parsing mode switch */}
        <div className="flex items-center gap-2 p-1 bg-surface rounded-xl border border-border w-fit text-xs">
          <button
            type="button"
            onClick={() => setParseMode("fast")}
            className={cn(
              "px-3 py-1.5 rounded-lg font-medium transition-colors",
              parseMode === "fast"
                ? "bg-brand text-white shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            ⚡ Fast Local Parse (0 tokens)
          </button>
          <button
            type="button"
            onClick={() => setParseMode("ai")}
            className={cn(
              "px-3 py-1.5 rounded-lg font-medium transition-colors",
              parseMode === "ai"
                ? "bg-brand text-white shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            ✨ AI Deep Parse (Local CLI / LLM)
          </button>
        </div>

        <div
          className="co-cvdrop p-6"
          data-over={over}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) ingestFile(f);
          }}
        >
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && paste.trim()) ingestText(paste.trim());
            }}
            placeholder="Paste your CV here — or drop a PDF / .md file below. Even a rough paste works; we'll clean it up."
            className="h-32 w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-faint text-foreground"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/50 px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-brand/40 hover:text-brand max-sm:min-h-[44px] max-sm:px-4"
            >
              <Upload className="size-3.5" /> Upload PDF / file
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.md,.markdown,.txt,.docx" hidden onChange={(e) => e.target.files?.[0] && ingestFile(e.target.files[0])} />
            <span className="inline-flex items-center gap-1 text-[11px] text-faint">
              <Lock className="size-3" /> Stays on your machine.
            </span>
            <button
              type="button"
              disabled={!paste.trim()}
              onClick={() => ingestText(paste.trim())}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50 max-sm:min-h-[44px]"
            >
              {parseMode === "ai" ? "Parse with AI" : "Read my CV"} <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
        {phase === "error" &&
          (err === "needs-cli" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span>To use AI Deep Parse, connect an AI CLI in Config. You can also switch to Fast Local Parse.</span>
              <Link href="/config" className="ml-auto inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2.5 py-1 font-medium text-amber-700 transition hover:bg-amber-500/30 dark:text-amber-200">
                Connect your AI CLI <ArrowRight className="size-3.5" />
              </Link>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[13px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-3.5 shrink-0" /> {err}
            </p>
          ))}
      </div>
    );
  }

  // ── PARSING ──
  if (phase === "parsing") {
    return (
      <div className="rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-sm">
        <style>{STYLE}</style>
        <div className="flex items-center gap-2.5">
          <Loader2 className="size-4 animate-spin text-brand" />
          <span className={`${instrumentSerif.className} text-lg text-foreground`}>{trace || "Reading your CV…"}</span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" /> {parseMode === "ai" ? "AI Engine Active" : "0 tokens · $0.00 · local"}
          </div>
          <button
            type="button"
            onClick={() => setPhase("input")}
            className="text-xs text-muted hover:text-foreground hover:underline"
          >
            Cancel &amp; paste text
          </button>
        </div>
        {md && <div className="co-cvtrace mt-4 max-h-40 overflow-hidden rounded-lg border border-border bg-surface/40 p-3 text-[11px] text-faint">{md.slice(0, 400)}…</div>}
      </div>
    );
  }

  // ── REVIEW ──
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 backdrop-blur-sm md:p-5">
      <style>{STYLE}</style>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FileText className="size-4 text-brand" />
        <h3 className={`${instrumentSerif.className} text-lg text-foreground`}>Here&apos;s your CV — review and save</h3>
        {readiness && (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              readiness.scoreable ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            {readiness.scoreable ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}
            {readiness.scoreable ? "Ready to match" : "A bit thin"}
          </span>
        )}
      </div>
      {readiness?.hint && <p className="mb-2 text-[12px] text-amber-600 dark:text-amber-400">{readiness.hint}</p>}
      {saveErr && (
        <p className="mb-2 flex items-center gap-1.5 text-[12px] text-red-500">
          <AlertTriangle className="size-3.5 shrink-0" /> {saveErr}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          className="h-72 w-full resize-none rounded-lg border border-border bg-surface/40 p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-brand/40 text-foreground"
        />
        <div className="prose prose-sm dark:prose-invert h-72 max-w-none overflow-y-auto rounded-lg border border-border bg-surface/40 p-3 text-[13px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={phase === "saving" || aiEnhancing}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
        >
          {phase === "saving" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save &amp; find my matches
        </button>
        <button
          type="button"
          onClick={enhanceWithAi}
          disabled={aiEnhancing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-brand/40 bg-brand-soft px-4 py-2.5 text-xs font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-50"
        >
          {aiEnhancing ? <Loader2 className="size-3.5 animate-spin" /> : "✨"}
          {aiEnhancing ? "Enhancing with AI..." : "Enhance with AI"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMd("");
            setSeed(null);
            setPhase("input");
          }}
          className="inline-flex items-center gap-1.5 text-[13px] text-muted transition hover:text-foreground"
        >
          <RotateCcw className="size-3.5" /> Start over
        </button>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-faint">
          <Lock className="size-3" /> Saved locally to cv.md &amp; profile.yml
        </span>
      </div>
    </div>
  );
}
