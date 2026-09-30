"use client";

import { useState, useRef } from "react";
import { X, Upload, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Internship = {
  id: string;
  company: string;
  role: string;
  resumeFile?: string;
};

type Props = {
  internship: Internship;
  onClose: () => void;
  onUpdated: () => void;
};

export function ResumeViewer({ internship, onClose, onUpdated }: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadResume = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", "resume");
    formData.append("description", `Tailored resume for ${internship.company} - ${internship.role}`);

    const uploadRes = await fetch("/api/uploads", { method: "POST", body: formData });
    if (uploadRes.ok) {
      const meta = await uploadRes.json();
      await fetch("/api/internships", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: internship.id, resumeFile: meta.filename }),
      });
      onUpdated();
    }
    setUploading(false);
  };

  const removeResume = async () => {
    await fetch("/api/internships", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: internship.id, resumeFile: "" }),
    });
    onUpdated();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadResume(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold">Tailored Resume</h2>
            <p className="text-xs text-muted">{internship.company} — {internship.role}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-hover transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {internship.resumeFile ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 p-4">
              <FileText className="h-8 w-8 text-brand shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{internship.resumeFile}</p>
                <p className="text-xs text-muted">Attached to this application</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Replace
              </Button>
              <Button variant="outline" size="sm" onClick={removeResume}>
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors",
              dragOver ? "border-brand bg-brand/5" : "border-border hover:border-brand/50",
            )}
          >
            <Upload className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-2 text-sm font-medium">
              {uploading ? "Uploading..." : "Drop your tailored resume here"}
            </p>
            <p className="mt-1 text-xs text-muted">PDF, DOCX, or Markdown</p>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.doc,.md,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadResume(file);
          }}
        />
      </div>
    </div>
  );
}
