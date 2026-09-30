"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onClose: () => void;
  onAdded: () => void;
};

export function AddInternshipModal({ onClose, onAdded }: Props) {
  const [form, setForm] = useState({
    company: "",
    role: "",
    location: "",
    url: "",
    deadline: "",
    notes: "",
    status: "wishlist" as const,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company || !form.role) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/internships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        onAdded();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Failed to add internship.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Add Internship</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-hover transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company *" value={form.company} onChange={(v) => set("company", v)} placeholder="Google" />
            <Field label="Role *" value={form.role} onChange={(v) => set("role", v)} placeholder="SWE Intern" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Location" value={form.location} onChange={(v) => set("location", v)} placeholder="Mountain View, CA" />
            <Field label="Deadline" value={form.deadline} onChange={(v) => set("deadline", v)} type="date" />
          </div>

          <Field label="Posting URL" value={form.url} onChange={(v) => set("url", v)} placeholder="https://..." />

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/50"
              placeholder="Referral contact, team info, etc."
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.company || !form.role}>
              {saving ? "Adding..." : "Add Internship"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/50"
      />
    </div>
  );
}
