// The ONE action registry — the single source of truth for "what can be done".
// Both UI controls and the assistant dispatch the SAME entries via dispatch(),
// so the human UI and the agentic UI can never drift. Pure module (no React
// hooks): the caller assembles `ctx` from its hooks and passes it in.
//
// The model emits intents as a vendor-neutral text envelope (<<act:ID {json}>>),
// parsed CLIENT-SIDE; the registry validates args by hand (no zod dep) and gates
// side-effects. Resolution of "all the Anthropic ones" happens here, off the
// client pipeline snapshot — the model never sees or invents URLs.

import type { Application, InboxJob } from "@/lib/career-ops";
import type { Job } from "@/components/jobs/job-store";
import { normalizeTextKey } from "@/lib/core/normalize-text-key.mjs";
import { postingKey } from "@/lib/job-url.mjs";

export const AUTO_FIRE_MAX = 3; // fire ≤3 evaluations silently; confirm above that
export const BATCH_CAP = 12; // hard ceiling on a single fan-out

// Canonical states (templates/states.yml) — the web validates against the same set.
const CANON_STATUS = ["Evaluated", "Applied", "Responded", "Interview", "Offer", "Hired", "Rejected", "Discarded", "SKIP"];

const TAB_VALUES = [
  "INBOX", "ALL", "EVALUATED", "APPLIED", "RESPONDED", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "DISCARDED", "SKIP",
] as const;
const SORT_VALUES = ["company", "role", "score", "status", "date"] as const;

export type StartJobInput = {
  title: string;
  subtitle?: string;
  kind: string;
  input: string;
  page?: string;
  batchId?: string;
};

// Same shape job-store.tsx's startEvaluate takes — a raw URL in, normalizeJobUrl's
// canonical url out as the job's `input`. See its header for why this exists, and
// job-url.mjs's for why that canonical url is not the same thing as postingKey.
export type StartEvaluateInput = {
  url: string;
  title?: string;
  subtitle?: string;
  page?: string;
  batchId?: string;
};

export type ActionCtx = {
  push: (path: string) => void; // router.push — section/detail change
  replace: (path: string) => void; // router.replace — incremental filter tweak
  startJob: (opts: StartJobInput) => string | null;
  startEvaluate: (opts: StartEvaluateInput) => string | null;
  inbox: InboxJob[];
  applications: Application[]; // tracker snapshot — resolve #n → company/role for confirms
  jobForUrl: (url: string) => Job | undefined; // skip-if-done / retry logic
  rememberFact: (fact: string) => void;
  writeStatus: (n: string, status: string) => void; // UPDATE-only writeback via /api/status
  setApplyField: (idOrLabel: string, value: string) => void; // edit an apply-proxy answer
  startApply: (url: string) => void; // open the apply form-proxy for a posting URL
  applyExplore?: (patch: Record<string, unknown>, opts?: { merge?: boolean; run?: boolean }) => void; // build a FREE discovery search
  writeProfile?: (patch: Record<string, unknown>) => void; // merge-safe config/profile.yml write
  writePortals?: (roles: string[], location?: string[]) => void; // merge-safe portals.yml title_filter write
};

export type ProfilePatch = {
  name?: string;
  email?: string;
  location?: string;
  roles?: string[];
  compMin?: number;
  compMax?: number;
  currency?: string;
  remote?: string;
  seniority?: string;
};

// House-style hand validation (no zod). Keeps only well-formed, confident fields.
function coerceProfile(raw: Record<string, unknown>): ProfilePatch {
  const out: ProfilePatch = {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  out.name = str(raw.name);
  out.email = str(raw.email);
  out.location = str(raw.location);
  out.currency = str(raw.currency);
  out.remote = str(raw.remote);
  out.seniority = str(raw.seniority);
  out.compMin = num(raw.compMin);
  out.compMax = num(raw.compMax);
  if (Array.isArray(raw.roles)) out.roles = raw.roles.filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => r.trim()).slice(0, 6);
  return out;
}

export type DoneInfo = { jobIds?: string[]; batchId?: string; note?: string };
export type DispatchResult =
  | ({ status: "done" } & DoneInfo)
  | { status: "ignored"; note?: string }
  | { status: "confirm"; summary: string; run: () => DoneInfo };

// ── helpers ──────────────────────────────────────────────────────────────
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
// Same shape as core normalizeTextKey(s, " ") — keeps accents/CJK, strips punct (#2666).
const normCompany = (s: string) => normalizeTextKey(s, " ");

// Allow only in-app routes (with optional :segment and ?query). Blocks anything
// that isn't one of the app's own sections — the model can't navigate offsite.
function isAllowedPath(p: string): boolean {
  if (!p.startsWith("/")) return false;
  if (/^(https?:)?\/\//i.test(p)) return false;
  const path = p.split(/[?#]/)[0];
  if (path === "/") return true;
  return /^\/(explore|pipeline|portals|analytics|cv|config|apply|jobs)(\/[^/]+)?$/.test(path);
}

function genBatchId(): string {
  return `batch-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}

// ── actions ──────────────────────────────────────────────────────────────
type ActionDef = {
  sideEffect: "none" | "spend" | "write";
  // parse returns typed args or null (invalid → envelope ignored)
  run: (raw: Record<string, unknown>, ctx: ActionCtx) => DispatchResult;
};

const ACTIONS: Record<string, ActionDef> = {
  navigate: {
    sideEffect: "none",
    run: (raw, ctx) => {
      const path = raw.path;
      if (!isStr(path) || !isAllowedPath(path)) return { status: "ignored", note: "blocked navigation" };
      ctx.push(path);
      return { status: "done" };
    },
  },

  filterPipeline: {
    sideEffect: "none",
    run: (raw, ctx) => {
      const sp = new URLSearchParams();
      const tab = typeof raw.tab === "string" ? raw.tab.toUpperCase() : "";
      if ((TAB_VALUES as readonly string[]).includes(tab)) sp.set("tab", tab);
      const min = typeof raw.min === "number" ? raw.min : parseFloat(String(raw.min ?? ""));
      if (Number.isFinite(min) && min >= 0 && min <= 5) sp.set("min", String(min));
      if (isStr(raw.q)) sp.set("q", String(raw.q).slice(0, 80));
      const sort = typeof raw.sort === "string" ? raw.sort : "";
      if ((SORT_VALUES as readonly string[]).includes(sort)) sp.set("sort", sort);
      const dir = Number(raw.dir);
      if (dir === 1 || dir === -1) sp.set("dir", String(dir));
      const qs = sp.toString();
      ctx.replace(`/pipeline${qs ? `?${qs}` : ""}`);
      return { status: "done" };
    },
  },

  evaluate: {
    sideEffect: "spend",
    run: (raw, ctx) => {
      const url = raw.url;
      // The ad-hoc http(s) sniff used to live here; postingKey (via startEvaluate)
      // now owns URL validity, so a malformed url surfaces as an errored job in
      // the Workers tray instead of being silently ignored pre-dispatch.
      if (!isStr(url)) return { status: "ignored", note: "invalid url" };
      // jobForUrl compares against job.input, which is always canonical now that
      // every launch site routes through startEvaluate — so the lookup key must
      // be canonical too, or a pipeline URL still carrying tracking noise would
      // never match the worker already running on it.
      const ex = ctx.jobForUrl(postingKey(url));
      if (ex && ex.status !== "error" && !raw.rerun) return { status: "ignored", note: "already evaluated" };
      const id = ctx.startEvaluate({
        title: isStr(raw.title) ? String(raw.title) : undefined,
        subtitle: isStr(raw.subtitle) ? String(raw.subtitle) : undefined,
        url,
        page: "/pipeline",
      });
      return { status: "done", jobIds: id ? [id] : [] };
    },
  },

  evaluateCompany: {
    sideEffect: "spend",
    run: (raw, ctx) => {
      const company = raw.company;
      if (!isStr(company)) return { status: "ignored", note: "missing company" };
      const target = normCompany(company);
      const rerun = raw.rerun === true;
      const cap = Number.isFinite(Number(raw.max)) ? Math.min(BATCH_CAP, Number(raw.max)) : BATCH_CAP;

      // statusScope: only 'inbox' is supported (Application rows carry no URL).
      const matches = ctx.inbox.filter((j) => {
        if (j.done) return false;
        const c = normCompany(j.company);
        return c === target || c.includes(target) || target.includes(c);
      });
      const pending = matches
        .filter((j) => {
          if (rerun) return true;
          // Same canonical-key reasoning as the `evaluate` action above.
          const ex = ctx.jobForUrl(postingKey(j.url));
          return !ex || ex.status === "error";
        })
        .slice(0, cap);

      if (pending.length === 0) {
        return {
          status: "ignored",
          note: matches.length > 0 ? `Already evaluated every ${company} posting.` : `No pending ${company} postings in your inbox.`,
        };
      }

      const fire = (): DoneInfo => {
        const batchId = pending.length > 1 ? genBatchId() : undefined;
        const ids = pending
          .map((j) =>
            ctx.startEvaluate({
              title: `Evaluate · ${j.company}`,
              subtitle: j.role,
              url: j.url,
              page: "/pipeline",
              batchId,
            }),
          )
          .filter((x): x is string => !!x);
        return { jobIds: ids, batchId };
      };

      if (pending.length <= AUTO_FIRE_MAX) return { status: "done", ...fire() };
      return {
        status: "confirm",
        summary: `Evaluate ${pending.length} ${company} postings? (~${pending.length} worker${pending.length > 1 ? "s" : ""})`,
        run: fire,
      };
    },
  },

  explore: {
    // FREE: opens the Explorer and builds a discovery search. Zero tokens — it
    // never spends, so it bypasses the confirm gate. The provider clamps/validates.
    sideEffect: "none",
    run: (raw, ctx) => {
      if (!ctx.applyExplore) return { status: "ignored", note: "explore unavailable here" };
      const run = raw.run === true;
      const merge = raw.merge === true;
      ctx.push("/explore");
      ctx.applyExplore(raw, { merge, run });
      return { status: "done", note: run ? "Scanning the ATS network for fresh roles (free)…" : "Opened Explore with your filters." };
    },
  },

  research: {
    sideEffect: "spend",
    run: (raw, ctx) => {
      const target = raw.target;
      if (!isStr(target)) return { status: "ignored", note: "missing target" };
      const id = ctx.startJob({
        title: isStr(raw.title) ? String(raw.title) : "Research",
        kind: "research",
        input: target,
        page: "/pipeline",
      });
      return { status: "done", jobIds: id ? [id] : [] };
    },
  },

  generatePdf: {
    sideEffect: "spend",
    run: (raw, ctx) => {
      const n = String(raw.n ?? "").trim();
      if (!n) return { status: "ignored", note: "need an application #" };
      const app = ctx.applications.find((a) => a.n === n);
      const id = ctx.startJob({ title: `CV PDF · ${app?.company ?? `#${n}`}`, subtitle: "tailored CV", kind: "pdf", input: n, page: `/pipeline/${n}` });
      return { status: "done", jobIds: id ? [id] : [] };
    },
  },

  setStatus: {
    sideEffect: "write",
    run: (raw, ctx) => {
      const n = String(raw.n ?? "").trim();
      const status = String(raw.status ?? "").trim();
      const canon = CANON_STATUS.find((s) => s.toLowerCase() === status.toLowerCase());
      if (!n || !canon) return { status: "ignored", note: "need an application # and a canonical status" };
      const app = ctx.applications.find((a) => a.n === n);
      const label = app ? `${app.company} · ${app.role}` : `#${n}`;
      return {
        status: "confirm",
        summary: `Mark ${label} → ${canon}?`,
        run: () => {
          ctx.writeStatus(n, canon);
          return { note: `Marked #${n} as ${canon}.` };
        },
      };
    },
  },

  apply: {
    sideEffect: "none",
    run: (raw, ctx) => {
      const url = raw.url;
      if (!isStr(url) || !/^https?:\/\//i.test(url)) return { status: "ignored", note: "need an application form URL" };
      ctx.startApply(url);
      return { status: "done", note: "Opening the application form…" };
    },
  },

  setApplyField: {
    sideEffect: "none",
    run: (raw, ctx) => {
      const field = (raw.field ?? raw.label) as unknown;
      const value = raw.value;
      if (!isStr(field) || typeof value !== "string") return { status: "ignored", note: "need a field and a value" };
      ctx.setApplyField(String(field), value);
      return { status: "done", note: `Updated "${field}".` };
    },
  },

  remember: {
    sideEffect: "write",
    run: (raw, ctx) => {
      const fact = raw.fact;
      if (!isStr(fact)) return { status: "ignored" };
      ctx.rememberFact(String(fact).trim());
      return { status: "done" };
    },
  },

  // Propose the user's profile → on confirm, merge-safe write to config/profile.yml
  // AND seed the scanner (portals.yml title_filter) so the very first scan has roles.
  // DATA_CONTRACT: deep-merge only proposed keys; never clobber archetypes/narrative.
  setProfile: {
    sideEffect: "write",
    run: (raw, ctx) => {
      if (!ctx.writeProfile) return { status: "ignored", note: "profile write unavailable here" };
      const p = coerceProfile(raw);
      const has = Object.values(p).some((v) => (Array.isArray(v) ? v.length : v !== undefined));
      if (!has) return { status: "ignored", note: "nothing to save" };
      const bits = [p.roles?.length ? `roles: ${p.roles.join(", ")}` : "", p.location ? `in ${p.location}` : "", p.compMin && p.compMax ? `comp ${p.compMin}–${p.compMax}` : ""].filter(Boolean).join(" · ");
      return {
        status: "confirm",
        summary: `Save your profile?${bits ? ` (${bits})` : ""}`,
        run: () => {
          ctx.writeProfile!(p as Record<string, unknown>);
          if (p.roles?.length) ctx.writePortals?.(p.roles, p.location ? [p.location] : undefined);
          return { note: "Profile saved — your matches will sharpen." };
        },
      };
    },
  },

  setPortals: {
    sideEffect: "write",
    run: (raw, ctx) => {
      if (!ctx.writePortals) return { status: "ignored", note: "portals write unavailable here" };
      const roles = Array.isArray(raw.roles) ? raw.roles.filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => r.trim()) : [];
      if (roles.length === 0) return { status: "ignored", note: "no roles" };
      const location = Array.isArray(raw.location) ? raw.location.filter((l): l is string => typeof l === "string") : undefined;
      return {
        status: "confirm",
        summary: `Set your scan targets to: ${roles.join(", ")}?`,
        run: () => {
          ctx.writePortals!(roles, location);
          return { note: "Scan targets updated." };
        },
      };
    },
  },
};

export function actionExists(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTIONS, id);
}

export function dispatch(id: string, rawArgs: Record<string, unknown>, ctx: ActionCtx): DispatchResult {
  // actionExists, not a bare ACTIONS[id] truthiness check: `id` is model-emitted
  // text from an <<act:ID>> envelope, so "constructor" or "toString" would resolve
  // off Object.prototype and reach `def.run(...)`. The catch below would absorb the
  // TypeError, but being safe by accident is not the same as being safe.
  if (!actionExists(id)) return { status: "ignored", note: `unknown action: ${id}` };
  const def = ACTIONS[id];
  try {
    return def.run(rawArgs ?? {}, ctx);
  } catch {
    return { status: "ignored", note: `could not run ${id}` };
  }
}
