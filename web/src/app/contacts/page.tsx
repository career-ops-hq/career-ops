"use client";

import { useState, useEffect } from "react";
import { Users, Plus, Mail, Globe, Copy, Check, Search, ShieldCheck } from "lucide-react";

type Contact = {
  id: string;
  name: string;
  company: string;
  role: string;
  source: string;
  linkedin?: string;
  email?: string;
  notes?: string;
  status: "identified" | "contacted" | "replied" | "referral";
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [connectionsCount, setConnectionsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newLinkedin, setNewLinkedin] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/contacts");
      const data = await res.json();
      setContacts(data.contacts || []);
      setConnectionsCount(data.connectionsCount || 0);
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newCompany) return;

    await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        company: newCompany,
        role: newRole,
        email: newEmail,
        linkedin: newLinkedin,
        notes: newNotes,
        status: "identified",
      }),
    });

    setModalOpen(false);
    setNewName("");
    setNewCompany("");
    setNewRole("");
    setNewEmail("");
    setNewLinkedin("");
    setNewNotes("");
    fetchContacts();
  };

  const copyOutreach = (contact: Contact) => {
    const text = `Hi ${contact.name},\n\nI noticed you're at ${contact.company} working in ${contact.role || "engineering"}. I've been following ${contact.company}'s work and wanted to connect.\n\nBest regards!`;
    navigator.clipboard.writeText(text);
    setCopiedId(contact.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filtered = contacts.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.company.toLowerCase().includes(search.toLowerCase()) ||
      c.role.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Users className="size-6 text-brand" />
            Contacts & Networking
          </h1>
          <p className="text-xs text-muted mt-1">
            Track recruiters, hiring managers, and warm intro paths. Data stored securely in <code className="text-[11px] font-mono bg-surface-hover px-1 py-0.5 rounded">data/contacts.tsv</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="size-4" />
            Add Contact
          </button>
        </div>
      </div>

      {/* Network stats card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-surface/50 p-4">
          <div className="text-xs text-muted font-medium">Saved Contacts</div>
          <div className="text-2xl font-bold text-foreground mt-1">{contacts.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface/50 p-4">
          <div className="text-xs text-muted font-medium">LinkedIn Network (Connections.csv)</div>
          <div className="text-2xl font-bold text-foreground mt-1">{connectionsCount}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface/50 p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-muted font-medium">Human-in-the-loop</div>
            <div className="text-xs text-brand-text font-semibold mt-1 flex items-center gap-1">
              <ShieldCheck className="size-3.5" /> No auto-messaging
            </div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 size-4 text-faint" />
          <input
            type="text"
            placeholder="Search by name, company, or role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted focus:border-brand focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="identified">Identified</option>
          <option value="contacted">Contacted</option>
          <option value="replied">Replied</option>
          <option value="referral">Referral</option>
        </select>
      </div>

      {/* Contacts list */}
      {loading ? (
        <div className="p-12 text-center text-sm text-muted">Loading contacts...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20">
          <Users className="size-10 text-faint mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No contacts found</h3>
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
            Add hiring managers, recruiters, or company peers to track outreach conversations.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 rounded-lg bg-surface-hover border border-border px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
          >
            Add your first contact
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface/50 text-faint font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Name & Role</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Links & Notes</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-surface-hover/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-foreground">{c.name}</div>
                    <div className="text-muted text-[11px]">{c.role || "Role not specified"}</div>
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{c.company}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-surface-hover border border-border px-2 py-0.5 text-[10px] font-medium text-foreground capitalize">
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted max-w-xs truncate">
                    <div className="flex items-center gap-2">
                      {c.linkedin && (
                        <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-brand hover:underline flex items-center gap-1">
                          <Globe className="size-3" /> Profile
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="text-foreground hover:underline flex items-center gap-1">
                          <Mail className="size-3" /> Email
                        </a>
                      )}
                    </div>
                    {c.notes && <div className="text-[11px] text-faint truncate mt-0.5">{c.notes}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => copyOutreach(c)}
                      className="inline-flex items-center gap-1 rounded bg-surface-hover border border-border/80 px-2.5 py-1 text-[11px] text-foreground hover:bg-brand-soft hover:text-brand-text transition-colors"
                    >
                      {copiedId === c.id ? <Check className="size-3 text-brand" /> : <Copy className="size-3" />}
                      {copiedId === c.id ? "Copied" : "Copy Outreach"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-base font-bold text-foreground">Add New Contact</h3>
            <form onSubmit={handleAdd} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Company *</label>
                <input
                  type="text"
                  required
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Role / Title</label>
                <input
                  type="text"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  placeholder="e.g. Engineering Manager, Recruiter"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Email</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">LinkedIn URL</label>
                  <input
                    type="url"
                    value={newLinkedin}
                    onChange={(e) => setNewLinkedin(e.target.value)}
                    placeholder="https://linkedin.com/in/..."
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  Save Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
