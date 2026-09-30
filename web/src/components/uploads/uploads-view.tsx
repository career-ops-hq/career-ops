"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Upload, FileText, FolderOpen, Trash2, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type UploadMeta = {
  id: string;
  filename: string;
  originalName: string;
  category: "resume" | "project";
  description: string;
  dateUploaded: string;
  size: number;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadsView() {
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "resume" | "project">("all");
  const [uploading, setUploading] = useState(false);
  const resumeRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/uploads");
      if (res.ok) setUploads(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const uploadFile = async (file: File, category: "resume" | "project", description = "") => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    formData.append("description", description);

    const res = await fetch("/api/uploads", { method: "POST", body: formData });
    if (res.ok) fetchData();
    setUploading(false);
  };

  const deleteUpload = async (id: string) => {
    const res = await fetch(`/api/uploads?id=${id}`, { method: "DELETE" });
    if (res.ok) fetchData();
  };

  const filtered = tab === "all" ? uploads : uploads.filter((u) => u.category === tab);
  const resumeCount = uploads.filter((u) => u.category === "resume").length;
  const projectCount = uploads.filter((u) => u.category === "project").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        Loading uploads...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          <Upload className="mr-2 inline-block h-6 w-6 text-brand" />
          Uploads
        </h1>
        <p className="mt-1 text-sm text-muted">
          Upload resumes and project files for context when tailoring applications.
        </p>
      </div>

      {/* Upload zones */}
      <div className="grid gap-4 sm:grid-cols-2">
        <DropZone
          icon={<FileText className="h-8 w-8" />}
          title="Resumes"
          subtitle="Base CVs, master resumes, LinkedIn exports"
          accept=".pdf,.docx,.doc,.md,.txt"
          uploading={uploading}
          inputRef={resumeRef}
          onFile={(f) => uploadFile(f, "resume")}
        />
        <DropZone
          icon={<FolderOpen className="h-8 w-8" />}
          title="Projects"
          subtitle="Portfolios, case studies, code samples, write-ups"
          accept=".pdf,.docx,.doc,.md,.txt,.zip,.tar.gz"
          uploading={uploading}
          inputRef={projectRef}
          onFile={(f) => uploadFile(f, "project")}
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          ["all", `All (${uploads.length})`],
          ["resume", `Resumes (${resumeCount})`],
          ["project", `Projects (${projectCount})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === key
                ? "border-brand text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* File list */}
      {filtered.length === 0 ? (
        <Card className="py-12 text-center">
          <File className="mx-auto h-10 w-10 text-muted" />
          <p className="mt-3 text-muted">
            {uploads.length === 0
              ? "No files uploaded yet. Drop files above to get started."
              : "No files in this category."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-4 rounded-xl border border-border bg-surface/50 p-4 hover:shadow-sm transition-shadow"
            >
              <div className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                item.category === "resume" ? "bg-brand/10 text-brand" : "bg-sky-500/10 text-sky-600 dark:text-sky-400",
              )}>
                {item.category === "resume" ? <FileText className="h-5 w-5" /> : <FolderOpen className="h-5 w-5" />}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.originalName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge tone={item.category === "resume" ? "warn" : "info"} className="text-[10px]">
                    {item.category}
                  </Badge>
                  <span className="text-xs text-muted">{formatSize(item.size)}</span>
                  <span className="text-xs text-muted">{item.dateUploaded}</span>
                </div>
                {item.description && (
                  <p className="mt-1 text-xs text-muted truncate">{item.description}</p>
                )}
              </div>

              <button
                onClick={() => deleteUpload(item.id)}
                className="rounded p-2 text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DropZone({
  icon,
  title,
  subtitle,
  accept,
  uploading,
  inputRef,
  onFile,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accept: string;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragOver ? "border-brand bg-brand/5" : "border-border hover:border-brand/50",
        )}
      >
        <div className="mx-auto text-muted">{icon}</div>
        <p className="mt-2 text-sm font-medium">
          {uploading ? "Uploading..." : title}
        </p>
        <p className="mt-1 text-xs text-muted">{subtitle}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </>
  );
}
