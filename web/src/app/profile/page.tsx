"use client";

import { useEffect, useState } from "react";
import {
  User,
  Mail,
  MapPin,
  Briefcase,
  DollarSign,
  Save,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Layers,
  Globe2,
  Phone,
  FileText,
  AlertCircle
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [github, setGithub] = useState("");

  // Target Roles & Archetypes
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [newRoleInput, setNewRoleInput] = useState("");

  // Compensation & Preferences
  const [currency, setCurrency] = useState("USD");
  const [targetRange, setTargetRange] = useState("");
  const [locationFlexibility, setLocationFlexibility] = useState("remote");

  // Raw YAML preview
  const [rawProfile, setRawProfile] = useState<Record<string, any> | null>(null);

  const fetchProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile");
      const data = await res.json();
      if (data.exists && data.profile) {
        const p = data.profile;
        setRawProfile(p);
        const c = p.candidate || {};
        setFullName(c.full_name || "");
        setTitle(c.title || "");
        setEmail(c.email || "");
        setPhone(c.phone || "");
        setLocation(c.location || "");
        setLinkedin(c.linkedin || "");
        setGithub(c.github || "");

        // Target roles
        const roles = Array.isArray(p.target_roles?.primary)
          ? p.target_roles.primary
          : Array.isArray(p.target_roles)
            ? p.target_roles
            : [];
        setTargetRoles(roles);

        // Compensation
        const comp = p.compensation || {};
        setCurrency(comp.currency || "USD");
        setTargetRange(comp.target_range || "");
        setLocationFlexibility(comp.location_flexibility || "remote");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleAddRole = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newRoleInput.trim();
    if (trimmed && !targetRoles.includes(trimmed)) {
      setTargetRoles([...targetRoles, trimmed]);
      setNewRoleInput("");
    }
  };

  const handleRemoveRole = (roleToRemove: string) => {
    setTargetRoles(targetRoles.filter((r) => r !== roleToRemove));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    const candidateObj: Record<string, any> = {
      ...(rawProfile?.candidate || {}),
      full_name: fullName.trim(),
      title: title.trim(),
      email: email.trim(),
      phone: phone.trim(),
      location: location.trim(),
      linkedin: linkedin.trim(),
    };
    delete candidateObj.github;

    const compObj: Record<string, any> = {
      ...(rawProfile?.compensation || {}),
      currency: currency.trim(),
      target_range: targetRange.trim(),
      location_flexibility: locationFlexibility,
    };

    const payload = {
      candidate: candidateObj,
      target_roles: {
        ...(typeof rawProfile?.target_roles === "object" && !Array.isArray(rawProfile?.target_roles)
          ? rawProfile.target_roles
          : {}),
        primary: targetRoles,
      },
      compensation: compObj,
    };

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save profile");
      setSaved(true);
      setRawProfile(data.profile);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Profile & Targeting
            </h1>
            <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">
              config/profile.yml
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Define your core facts, target archetypes, and compensation constraints for automated job scoring.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/cv"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm transition hover:bg-surface-hover"
          >
            <FileText className="size-3.5 text-brand" />
            <span>Sync with CV</span>
          </Link>

          <button
            onClick={handleSave}
            disabled={saving || loading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold shadow-sm transition",
              saved
                ? "bg-emerald-600 text-white"
                : "bg-brand text-white hover:bg-brand/90 disabled:opacity-50",
            )}
          >
            {saving ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span>{saving ? "Saving…" : saved ? "Saved!" : "Save Profile"}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted">
          <RefreshCw className="mr-2 size-4 animate-spin text-brand" />
          <span>Loading profile facts…</span>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Info */}
          <div className="space-y-6 lg:col-span-2">
            {/* Candidate Identity */}
            <div className="rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-sm">
              <div className="flex items-center gap-2 border-b border-border/60 pb-3">
                <User className="size-4 text-brand" />
                <h2 className="text-sm font-semibold text-foreground">Candidate Identity</h2>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-muted">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Jane Doe"
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">Professional Headline</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Staff AI Systems Engineer"
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">Email Address</label>
                  <div className="relative mt-1">
                    <Mail className="absolute left-3 top-2.5 size-4 text-faint" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@example.com"
                      className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">Phone Number</label>
                  <div className="relative mt-1">
                    <Phone className="absolute left-3 top-2.5 size-4 text-faint" />
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">Location / Base</label>
                  <div className="relative mt-1">
                    <MapPin className="absolute left-3 top-2.5 size-4 text-faint" />
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="San Francisco, CA (or Remote)"
                      className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">LinkedIn Profile</label>
                  <input
                    type="text"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="linkedin.com/in/janedoe"
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Target Job Roles & Archetypes */}
            <div className="rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <div className="flex items-center gap-2">
                  <Briefcase className="size-4 text-brand" />
                  <h2 className="text-sm font-semibold text-foreground">Target Role Archetypes</h2>
                </div>
                <span className="text-[11px] text-faint">Matched in Block A/B evaluations</span>
              </div>

              <div className="mt-4 space-y-3">
                <form onSubmit={handleAddRole} className="flex gap-2">
                  <input
                    type="text"
                    value={newRoleInput}
                    onChange={(e) => setNewRoleInput(e.target.value)}
                    placeholder="Add target role (e.g. Lead Machine Learning Engineer)"
                    className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-surface border border-border px-3.5 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:border-brand"
                  >
                    Add
                  </button>
                </form>

                <div className="flex flex-wrap gap-2 pt-2">
                  {targetRoles.map((role) => (
                    <span
                      key={role}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/80 px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      <Sparkles className="size-3 text-brand" />
                      <span>{role}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveRole(role)}
                        className="ml-1 text-faint hover:text-red-400"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {targetRoles.length === 0 && (
                    <p className="text-xs text-faint italic">No target roles configured yet. Add role keywords above.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Compensation & Flexibility */}
            <div className="rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-sm">
              <div className="flex items-center gap-2 border-b border-border/60 pb-3">
                <DollarSign className="size-4 text-brand" />
                <h2 className="text-sm font-semibold text-foreground">Compensation & Location Policy</h2>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="text-xs font-medium text-muted">Currency</label>
                  <input
                    type="text"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    placeholder="USD, EUR, GBP"
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">Target Comp Range</label>
                  <input
                    type="text"
                    value={targetRange}
                    onChange={(e) => setTargetRange(e.target.value)}
                    placeholder="180000-240000"
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">Location Flexibility</label>
                  <select
                    value={locationFlexibility}
                    onChange={(e) => setLocationFlexibility(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
                  >
                    {!["remote", "hybrid", "onsite", "any"].includes(locationFlexibility) && locationFlexibility && (
                      <option value={locationFlexibility}>{locationFlexibility}</option>
                    )}
                    <option value="remote">Remote Only</option>
                    <option value="hybrid">Hybrid (Local Office)</option>
                    <option value="onsite">On-site (Relocation Open)</option>
                    <option value="any">Flexible / Any</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Side Info & Directives */}
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-surface/40 p-5">
              <div className="flex items-center gap-2 border-b border-border/60 pb-3">
                <Layers className="size-4 text-brand" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Data Contract Rule</h3>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-faint">
                <strong className="text-foreground">config/profile.yml</strong> is a protected User-Layer file. System updates will never overwrite your targeting facts, archetypes, or contact details.
              </p>
              <div className="mt-4 rounded-xl border border-border/80 bg-surface/80 p-3 text-[11px] text-muted">
                <p className="font-medium text-foreground">Where facts live:</p>
                <ul className="mt-1 space-y-1 list-disc list-inside text-faint">
                  <li><code>cv.md</code>: Verbatim accomplishments</li>
                  <li><code>profile.yml</code>: Targeting & constraints</li>
                  <li><code>modes/_profile.md</code>: North Star narrative</li>
                </ul>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="rounded-2xl border border-border bg-surface/40 p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Quick Actions</h3>
              <div className="mt-3 space-y-2">
                <Link
                  href="/cv"
                  className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-medium text-foreground hover:bg-surface-hover hover:border-brand/40"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="size-3.5 text-brand" />
                    <span>Upload or Edit CV</span>
                  </span>
                  <span className="text-[10px] text-faint">/cv</span>
                </Link>

                <Link
                  href="/documents"
                  className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-medium text-foreground hover:bg-surface-hover hover:border-brand/40"
                >
                  <span className="flex items-center gap-2">
                    <Globe2 className="size-3.5 text-brand" />
                    <span>Intake Document Vault</span>
                  </span>
                  <span className="text-[10px] text-faint">/documents</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
