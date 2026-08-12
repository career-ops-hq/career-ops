/**
 * email-connectors.mjs — Email connector foundation (FAS 5)
 *
 * Connector interface for email providers. Architecture is ready for
 * Gmail / Outlook (Microsoft 365) via official OAuth, and IMAP later.
 *
 * FAS 5 SAFETY RULES (enforced here):
 *  - No real email is ever sent: sendEmail() is BLOCKED unless the caller
 *    explicitly opts in with allowSend=true (never done in FAS 5).
 *  - No passwords are ever stored or requested — OAuth code flow only.
 *  - Tokens/secrets go through secure credential storage (0600 files,
 *    never in git). In FAS 5 all credentials are clearly marked mock.
 */

import path from "node:path";
import {
  ensurePrivateDirectory,
  secureAtomicWrite,
  secureDelete,
  secureReadText,
  resolvePrivatePath,
} from "./secure-user-storage.mjs";

/* ------------------------------------------------------------------ */
/* Connector registry                                                  */
/* ------------------------------------------------------------------ */

export const CONNECTOR_KINDS = ["oauth2", "imap"];
export const CONNECTOR_CAPABILITIES = [
  "list-email",
  "save-draft",
  "send-email",
  "classify-email",
  "create-message",
];

/**
 * Create an empty connector registry.
 * @returns {{ connectors: Map, register: Function, get: Function, list: Function }}
 */
export function createConnectorRegistry() {
  const connectors = new Map();
  return {
    connectors,
    register(connector) {
      if (!connector || typeof connector !== "object") {
        throw new Error("connector must be an object");
      }
      if (!connector.id || typeof connector.id !== "string") {
        throw new Error("connector requires a string id");
      }
      if (!CONNECTOR_KINDS.includes(connector.kind)) {
        throw new Error(`connector kind must be one of: ${CONNECTOR_KINDS.join(", ")}`);
      }
      if (connectors.has(connector.id)) {
        throw new Error(`connector redan registrerad: ${connector.id}`);
      }
      const record = {
        ...connector,
        capabilities: Array.isArray(connector.capabilities)
          ? [...new Set(connector.capabilities)]
          : [],
      };
      connectors.set(connector.id, record);
      return record;
    },
    get(id) {
      const c = connectors.get(id);
      if (!c) throw new Error(`okänd connector: ${id}`);
      return c;
    },
    list() {
      return [...connectors.values()];
    },
  };
}

/**
 * Define a connector object with the standard shape and validation.
 * @param {object} def — { id, name, kind, capabilities, connect?, listEmails?, saveDraft?, sendEmail? }
 */
export function defineConnector(def) {
  const allowed = ["id", "name", "kind", "capabilities", "connect", "listEmails", "saveDraft", "sendEmail"];
  for (const key of Object.keys(def)) {
    if (!allowed.includes(key)) throw new Error(`okänd connector-fält: ${key}`);
  }
  if (!def || typeof def !== "object") throw new Error("connector must be an object");
  if (!CONNECTOR_KINDS.includes(def.kind)) {
    throw new Error(`okänd connector-kind: ${def.kind} (tillåtna: ${CONNECTOR_KINDS.join(", ")})`);
  }
  return { ...def };
}

/* ------------------------------------------------------------------ */
/* Mock OAuth flow (FAS 5 — no real provider calls)                    */
/* ------------------------------------------------------------------ */

export function mockOAuthUrl(connectorId) {
  const base = "https://mock-oauth.invalid/authorize";
  return `${base}?client_id=careerpilot-fas5&connector=${encodeURIComponent(connectorId)}&response_type=code&scope=email.readonly`;
}

/**
 * Exchange a mock OAuth code for clearly-marked mock credentials.
 * Never stores passwords. The returned token is prefixed "mock_".
 */
export function mockExchangeCode(connectorId, code) {
  if (!code || typeof code !== "string") {
    throw new Error("mock OAuth requires a code");
  }
  const now = Date.now();
  return {
    connectorId,
    accessToken: `mock_${connectorId}_${now.toString(36)}`,
    refreshToken: `mock_${connectorId}_refresh_${now.toString(36)}`,
    tokenType: "Bearer",
    expiresAt: now + 3600 * 1000,
    mock: true,
    obtainedAt: new Date(now).toISOString(),
    scope: "email.readonly",
  };
}

export function isMockCredential(cred) {
  return Boolean(cred && (cred.mock === true || String(cred.accessToken || "").startsWith("mock_")));
}

/* ------------------------------------------------------------------ */
/* Secure credential storage                                           */
/* ------------------------------------------------------------------ */

const CREDENTIAL_DIR = (root) => resolvePrivatePath(root, path.join("data", "email-hub", "credentials"));

function credentialPath(root, connectorId) {
  return path.join(CREDENTIAL_DIR(root), `${connectorId}.json`);
}

/**
 * Save connector credentials to secure storage (0600 file).
 * @param {string} root — project root
 * @param {object} credential — result of mockExchangeCode()
 */
export async function saveConnectorCredentials(root, credential) {
  if (!credential || !credential.connectorId) {
    throw new Error("credential requires connectorId");
  }
  if (!isMockCredential(credential)) {
    // FAS 5: only mock credentials may be stored; real OAuth arrives in a later phase.
    throw new Error("refusing to store non-mock credentials in FAS 5");
  }
  const file = credentialPath(root, credential.connectorId);
  await secureAtomicWrite(root, file, JSON.stringify(
      {
        connectorId: credential.connectorId,
        accessToken: credential.accessToken,
        refreshToken: credential.refreshToken,
        tokenType: credential.tokenType,
        expiresAt: credential.expiresAt,
        mock: true,
        obtainedAt: credential.obtainedAt,
        scope: credential.scope,
      },
      null,
      2,
    ),
  );
  return file;
}

export async function readConnectorCredentials(root, connectorId) {
  const text = await secureReadText(root, credentialPath(root, connectorId), "");
  if (!text) return null;
  return JSON.parse(text);
}

export async function deleteConnectorCredentials(root, connectorId) {
  const result = await secureDelete(root, credentialPath(root, connectorId));
  return { ...result, connectorId };
}

/* ------------------------------------------------------------------ */
/* Gmail + Outlook mock connectors (FAS 5)                             */
/* ------------------------------------------------------------------ */

const MOCK_INBOX = [
  {
    id: "mock-email-1",
    from: "recruiter@acme.example",
    fromName: "Sara Lindqvist",
    to: "you@example.com",
    subject: "Din ansökan till Frontend-utvecklare hos Acme AB",
    date: "2026-08-06T09:15:00.000Z",
    body: "Hej! Tack för din ansökan. Vi vill gärna boka en intervju nästa vecka. Hälsningar Sara Lindqvist, Acme AB.",
  },
  {
    id: "mock-email-2",
    from: "jobs@noreply.example",
    fromName: "Jobbportal",
    to: "you@example.com",
    subject: "Jobb: Senior Systemutvecklare i Stockholm",
    date: "2026-08-05T07:00:00.000Z",
    body: "Ny annons: Senior Systemutvecklare, Stockholm, hybrid. Ansök senast 2026-08-20.",
  },
];

/**
 * Gmail connector (mock). kind oauth2, official OAuth architecture.
 */
export function gmailConnector() {
  return defineConnector({
    id: "gmail",
    name: "Gmail (Google)",
    kind: "oauth2",
    capabilities: ["list-email", "save-draft", "send-email", "classify-email", "create-message"],
    connect: () => ({ status: "mock", url: mockOAuthUrl("gmail") }),
    listEmails: async () => JSON.parse(JSON.stringify(MOCK_INBOX)),
    saveDraft: async (msg) => ({ mock: true, savedAs: "draft", message: msg.id || "generated" }),
    sendEmail: async () => {
      throw new Error("sendEmail is BLOCKED in FAS 5 — no real email may be sent without explicit user approval");
    },
  });
}

/**
 * Outlook / Microsoft 365 connector (mock). kind oauth2.
 */
export function outlookConnector() {
  return defineConnector({
    id: "outlook",
    name: "Outlook (Microsoft 365)",
    kind: "oauth2",
    capabilities: ["list-email", "save-draft", "send-email", "classify-email", "create-message"],
    connect: () => ({ status: "mock", url: mockOAuthUrl("outlook") }),
    listEmails: async () => JSON.parse(JSON.stringify(MOCK_INBOX)),
    saveDraft: async (msg) => ({ mock: true, savedAs: "draft", message: msg.id || "generated" }),
    sendEmail: async () => {
      throw new Error("sendEmail is BLOCKED in FAS 5 — no real email may be sent without explicit user approval");
    },
  });
}

/**
 * IMAP placeholder connector shape — proves the interface supports IMAP
 * providers later. Not registered in FAS 5 (no IMAP credentials exist).
 */
export function imapConnectorShape() {
  return {
    kind: "imap",
    capabilities: ["list-email", "classify-email", "create-message"],
    connect: () => ({ status: "imap-not-configured", url: null }),
  };
}

export function defaultEmailRegistry() {
  const registry = createConnectorRegistry();
  registry.register(gmailConnector());
  registry.register(outlookConnector());
  return registry;
}
