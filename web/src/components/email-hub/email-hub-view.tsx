"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/* ── Types ──────────────────────────────────────────────────────────── */

interface ConnectorStatus {
  id: string;
  name: string;
  kind: string;
  capabilities: string[];
  connected: boolean;
  mock: boolean;
  status: string;
}

interface HubMessage {
  id: string;
  connectorId: string;
  from: string;
  fromName: string;
  subject: string;
  body: string;
  date: string;
  classification: { id: string; label: string; confidence: number; signals: string[] };
  entities: Record<string, { value: string; confidence?: number } | null>;
  jobLink: {
    jobId?: string;
    company?: string;
    role?: string;
    confidence?: number;
    needsUserConfirmation?: boolean;
    reasons?: string[];
    candidates?: Array<{ jobId: string; company: string; role: string }>;
  } | null;
  actions: Array<{ action: string; at: string; result?: string; mock?: boolean }>;
}

const EMAIL_CLASS_TONE: Record<string, "good" | "warn" | "bad" | "info" | "muted"> = {
  "job-alert": "info",
  "recruiter-message": "good",
  "application-confirmation": "info",
  interview: "good",
  "assessment-test": "warn",
  "follow-up": "muted",
  rejection: "bad",
  offer: "good",
  other: "muted",
};

/* ── Helpers ────────────────────────────────────────────────────────── */

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

/* ── Email Hub view ─────────────────────────────────────────────────── */

export function EmailHubView() {
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [messages, setMessages] = useState<HubMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState({ from: "", subject: "", body: "" });
  const [expanded, setExpanded] = useState<string>("");

  const loadAll = useCallback(async () => {
    try {
      const cRes = await fetch("/api/email-hub/connectors", { cache: "no-store" });
      const cData = await cRes.json();
      setConnectors(Array.isArray(cData?.connectors) ? cData.connectors : []);
      const mRes = await fetch("/api/email-hub/emails", { cache: "no-store" });
      const mData = await mRes.json();
      setMessages(Array.isArray(mData?.messages) ? mData.messages : []);
    } catch {
      setError("Kunde inte läsa e-posthubbens data.");
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const connect = async (connectorId: string) => {
    setBusy(true);
    setError("");
    try {
      const data = await postJson("/api/email-hub/connectors", { action: "connect", connectorId, code: "mock-auth-code" });
      if (!data.ok) throw new Error(data.error || "koppling misslyckades");
      setNotice(`${data.connector?.name} kopplad (mock — ingen riktig anslutning).`);
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (connectorId: string) => {
    setBusy(true);
    try {
      const data = await postJson("/api/email-hub/connectors", { action: "disconnect", connectorId });
      if (!data.ok) throw new Error(data.error || "frånkoppling misslyckades");
      setNotice("Connector frånkopplad.");
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ingest = async () => {
    if (!compose.subject.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await postJson("/api/email-hub/emails", {
        email: { from: compose.from || "rekryterare@exempel.se", subject: compose.subject, body: compose.body },
      });
      if (!data.ok) throw new Error(data.error || "inskanning misslyckades");
      setNotice(`Klassificerad som: ${data.message?.classification?.label ?? "?"}${data.message?.jobLink?.needsUserConfirmation ? " — osäker jobbkoppling, granska!" : ""}`);
      setCompose({ from: "", subject: "", body: "" });
      setComposeOpen(false);
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (messageId: string, action: string) => {
    setError("");
    try {
      const data = await postJson("/api/email-actions", { action, messageId });
      if (!data.ok) throw new Error(data.error || "åtgärden gick inte att utföra");
      setNotice(data.notice || `Åtgärd: ${action} (mock)`);
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">E-posthubb — grund</h1>
          <p className="text-sm text-muted-foreground">
            Klassificera jobbrelaterad e-post, koppla till pipelinen och förbered svar.{" "}
            <strong>Ingen riktig e-post skickas under FAS 5.</strong>
          </p>
        </div>
        <Badge tone="info">FAS 5 — Foundation</Badge>
      </div>

      {error && <Card className="border-red-500/40 bg-red-50 p-4 text-sm text-red-700">{error}</Card>}
      {notice && <Card className="border-emerald-500/40 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</Card>}

      {/* Connectors */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">E-postleverantörer (connectors)</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {connectors.map((c) => (
            <div key={c.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.kind === "oauth2" ? "OAuth 2.0" : c.kind}</span>
                </div>
                {c.connected ? <Badge tone="good">Kopplad (mock)</Badge> : <Badge tone="muted">Ej kopplad</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Klarhet: {c.capabilities.join(", ")}</p>
              <div className="mt-2">
                {c.connected ? (
                  <Button size="sm" variant="outline" onClick={() => disconnect(c.id)} disabled={busy}>
                    Koppla från
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => connect(c.id)} disabled={busy}>
                    Koppla (mock OAuth)
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Endast officiell OAuth-arkitektur. Inga lösenord lagras någonsin — tokens hamnar i säker credential storage (0600).
        </p>
      </Card>

      {/* Inbox */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Jobbmejl ({messages.length})</h2>
          <Button size="sm" variant="outline" onClick={() => setComposeOpen(!composeOpen)}>
            {composeOpen ? "Stäng" : "+ Lägg till mejl (mock)"}
          </Button>
        </div>

        {composeOpen && (
          <div className="mb-4 space-y-2 rounded-md border p-3">
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Från (t.ex. rekryterare@foretag.se)"
              value={compose.from}
              onChange={(e) => setCompose({ ...compose, from: e.target.value })}
            />
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Ämne (t.ex. Inbjudan till intervju — Frontend-utvecklare)"
              value={compose.subject}
              onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
            />
            <textarea
              className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm"
              placeholder="Innehåll…"
              value={compose.body}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })}
            />
            <Button size="sm" onClick={ingest} disabled={busy || !compose.subject.trim()}>
              Klassificera & spara
            </Button>
          </div>
        )}

        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Inga mejl ännu. Lägg till ett mock-mejl för att se klassificering, extrahering och jobbkoppling.
          </p>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <li key={m.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">{m.subject}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {m.fromName ? `${m.fromName} <${m.from}>` : m.from} · {m.date.slice(0, 16)}
                    </span>
                  </div>
                  <Badge tone={EMAIL_CLASS_TONE[m.classification.id] ?? "muted"}>
                    {m.classification.label} ({Math.round(m.classification.confidence * 100)}%)
                  </Badge>
                </div>

                {m.jobLink && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {m.jobLink.jobId ? (
                      <Badge tone={m.jobLink.needsUserConfirmation ? "warn" : "good"}>
                        {m.jobLink.needsUserConfirmation ? "Osäker koppling →" : "Kopplad till:"} {m.jobLink.company} · {m.jobLink.role}
                      </Badge>
                    ) : (
                      <Badge tone="warn">Kan inte koppla automatiskt — granska manuellt</Badge>
                    )}
                    {m.jobLink.needsUserConfirmation && m.jobLink.candidates && (
                      <span className="text-muted-foreground">Kandidater: {m.jobLink.candidates.map((c) => `${c.company}/${c.role}`).join(", ")}</span>
                    )}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === m.id ? "" : m.id)}>
                    Detaljer
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => runAction(m.id, "create-response")}>
                    Skapa svar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => runAction(m.id, "save-draft")}>
                    Spara som utkast
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => runAction(m.id, "open-in-email")}>
                    Öppna i e-post
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => runAction(m.id, "send")}>
                    Skicka (blockerad)
                  </Button>
                </div>

                {expanded === m.id && (
                  <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-3 text-xs">
                    <p className="whitespace-pre-wrap">{m.body || "(ingen text)"}</p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {Object.entries(m.entities).map(([key, val]) => (
                        <p key={key}>
                          <span className="font-medium">{key}:</span>{" "}
                          {val ? `${val.value}${val.confidence ? ` (${Math.round(val.confidence * 100)}%)` : ""}` : "—"}
                        </p>
                      ))}
                    </div>
                    {m.actions.length > 0 && (
                      <p className="text-muted-foreground">
                        Åtgärder: {m.actions.map((a) => `${a.action}${a.mock ? " (mock)" : ""} @ ${a.at.slice(0, 16)}`).join(" · ")}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
