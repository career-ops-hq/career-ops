"use client";

import { Children, isValidElement, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseTaskItems, tickKey, countDone } from "@/lib/prep.mjs";
import { ChevronRight, Folder, FolderOpen, FileText, FileCode, FileType, Download, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from "lucide-react";

type Task = { id: string; text: string; done: boolean };
type Progress = { ticks: Record<string, boolean>; tasks: Record<string, Task[]> };
const plain = (n: React.ReactNode): string =>
  Children.toArray(n).map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement(c) ? plain((c.props as any).children) : "")).join("");

type F = { path: string; size: number; mtime: number };
type TNode = { name: string; path: string; children: Map<string, TNode>; file?: F };
const url = (p: string) => `/api/output?file=${encodeURIComponent(p)}`;

function buildTree(files: F[]): TNode {
  const root: TNode = { name: "", path: "", children: new Map() };
  for (const f of files) {
    let n = root;
    f.path.split("/").forEach((part, i, a) => {
      const p = a.slice(0, i + 1).join("/");
      if (!n.children.has(part)) n.children.set(part, { name: part, path: p, children: new Map() });
      n = n.children.get(part)!;
      if (i === a.length - 1) n.file = f;
    });
  }
  return root;
}

const latest = (n: TNode): number => (n.file ? n.file.mtime : Math.max(0, ...[...n.children.values()].map(latest)));
// folders first (newest activity first), then files by name
const sorted = (n: TNode) =>
  [...n.children.values()].sort((a, b) =>
    !!a.file === !!b.file ? (a.file ? a.name.localeCompare(b.name) : latest(b) - latest(a)) : a.file ? 1 : -1,
  );

function iconFor(name: string) {
  const e = name.split(".").pop()?.toLowerCase();
  return e === "md" ? FileText : e === "html" || e === "json" ? FileCode : FileType;
}

function Row({ n, depth, sel, onSel }: { n: TNode; depth: number; sel: string | null; onSel: (p: string) => void }) {
  const [open, setOpen] = useState(!!sel && sel.startsWith(n.path + "/"));
  const pad = { paddingLeft: 8 + depth * 14 };
  if (n.file) {
    const Icon = iconFor(n.name);
    return (
      <button
        onClick={() => onSel(n.path)}
        style={pad}
        title={n.path}
        className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-sm hover:bg-surface ${sel === n.path ? "bg-surface font-medium text-brand" : ""}`}
      >
        <Icon className="size-4 shrink-0 text-muted" />
        <span className="truncate">{n.name}</span>
      </button>
    );
  }
  const Icon = open ? FolderOpen : Folder;
  return (
    <div>
      <button onClick={() => setOpen(!open)} style={pad} className="flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-sm hover:bg-surface">
        <ChevronRight className={`size-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
        <Icon className="size-4 shrink-0 text-brand" />
        <span className="truncate">{n.name}</span>
      </button>
      {open && sorted(n).map((c) => <Row key={c.path} n={c} depth={depth + 1} sel={sel} onSel={onSel} />)}
    </div>
  );
}

export function OutputViewer() {
  const [files, setFiles] = useState<F[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [showTree, setShowTree] = useState(true);
  const [prog, setProg] = useState<Progress>({ ticks: {}, tasks: {} });
  const [newTask, setNewTask] = useState("");
  const company = sel?.split("/")[0] ?? null;

  useEffect(() => {
    fetch("/api/prep-progress").then((r) => r.json()).then((d) => setProg({ ticks: d.ticks ?? {}, tasks: d.tasks ?? {} })).catch(() => {});
  }, []);
  const saveProg = (next: Progress) => {
    setProg(next);
    fetch("/api/prep-progress", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }).catch(() => {});
  };
  const isDone = (file: string, t: string, mark: boolean) => prog.ticks[tickKey(file, t)] ?? mark;
  const toggleTick = (file: string, t: string, to: boolean) => saveProg({ ...prog, ticks: { ...prog.ticks, [tickKey(file, t)]: to } });
  const myTasks = (company && prog.tasks[company]) || [];
  const setTasks = (list: Task[]) => company && saveProg({ ...prog, tasks: { ...prog.tasks, [company]: list } });
  const items = parseTaskItems(text);
  const itemsDone = sel ? countDone(sel, items, prog.ticks) : 0;

  useEffect(() => {
    fetch("/api/output").then((r) => r.json()).then((d) => {
      const list: F[] = d.files ?? [];
      // ?company=slug opens that company's folder and its most useful file
      const slug = new URLSearchParams(window.location.search).get("company");
      if (slug) {
        const mine = list.filter((f) => f.path.split("/")[0] === slug);
        const pick = ["interview-prep.md", "evaluation.md"].map((n) => mine.find((f) => f.path.endsWith("/" + n))).find(Boolean) ?? mine[0];
        if (pick) setSel(pick.path);
      }
      setFiles(list);
    });
  }, []);

  const tree = useMemo(() => buildTree(files), [files]);
  const ext = sel?.split(".").pop()?.toLowerCase();
  useEffect(() => {
    setText("");
    if (sel && (ext === "md" || ext === "json" || ext === "txt")) fetch(url(sel)).then((r) => r.text()).then(setText);
  }, [sel, ext]);

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4 p-4">
      {showTree && <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto"><div className="rounded border border-border bg-surface/30 p-2">
        {sorted(tree).map((n) => <Row key={n.path} n={n} depth={0} sel={sel} onSel={setSel} />)}
        {!files.length && <p className="p-2 text-sm text-muted">No files in output/.</p>}
      </div>
      {company && (
        <div className="rounded border border-border bg-surface/30 p-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">My prep tasks · {company}</p>
          {myTasks.map((t) => (
            <label key={t.id} className="group flex items-start gap-2 py-0.5 text-sm">
              <input type="checkbox" checked={t.done} className="mt-1 accent-[var(--color-brand)]"
                onChange={(e) => setTasks(myTasks.map((x) => (x.id === t.id ? { ...x, done: e.target.checked } : x)))} />
              <span className={`flex-1 ${t.done ? "text-faint line-through" : ""}`}>{t.text}</span>
              <button onClick={() => setTasks(myTasks.filter((x) => x.id !== t.id))} className="text-faint opacity-0 hover:text-fg group-hover:opacity-100" title="Remove">
                <Trash2 className="size-3.5" />
              </button>
            </label>
          ))}
          {!!myTasks.length && <p className="mt-1 text-xs text-faint">{myTasks.filter((t) => t.done).length}/{myTasks.length} done</p>}
          <form className="mt-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (newTask.trim()) { setTasks([...myTasks, { id: String(Date.now()), text: newTask.trim(), done: false }]); setNewTask(""); } }}>
            <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a task…"
              className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 text-xs" />
            <button type="submit" className="rounded border border-border px-1.5 text-muted hover:text-fg" title="Add"><Plus className="size-3.5" /></button>
          </form>
        </div>
      )}
      </div>}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
          <button onClick={() => setShowTree(!showTree)} title={showTree ? "Hide file list" : "Show file list"} className="hover:text-fg">
            {showTree ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </button>
          <span className="min-w-0 flex-1 truncate">{sel}</span>
          {ext === "md" && items.length > 0 && (
            <span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-brand-text">Checklist {itemsDone}/{items.length}</span>
          )}
          {sel && (
            <a href={url(sel)} download={sel.split("/").pop()} className="flex items-center gap-1 hover:text-fg">
              <Download className="size-3.5" />Download
            </a>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!sel ? (
            <p className="p-4 text-sm text-muted">Open a folder and pick a file.</p>
          ) : ext === "pdf" || ext === "html" ? (
            <iframe src={url(sel)} className="h-full w-full" />
          ) : ext === "md" ? (
            <div className="report-prose p-6">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  li: ({ node, className, children, ...rest }) => {
                    void node;
                    if (!String(className ?? "").includes("task-list-item")) return <li className={className} {...rest}>{children}</li>;
                    const kids = Children.toArray(children);
                    const box = kids.find((c) => isValidElement(c) && (c.props as any).type === "checkbox") as React.ReactElement<any> | undefined;
                    const body = kids.filter((c) => c !== box);
                    const t = plain(body);
                    const done = isDone(sel, t, !!box?.props.checked);
                    return (
                      <li className={`${className} list-none -ml-5`} {...rest}>
                        <input type="checkbox" checked={done} onChange={(e) => toggleTick(sel, t, e.target.checked)} className="mr-2 accent-[var(--color-brand)]" />
                        <span className={done ? "text-faint line-through" : ""}>{body}</span>
                      </li>
                    );
                  },
                }}
              >{text}</ReactMarkdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap p-4 font-mono text-xs">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
