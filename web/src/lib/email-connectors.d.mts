/**
 * email-connectors.d.ts — Type declarations for email-connectors.mjs (FAS 5)
 */

export type ConnectorKind = "oauth2" | "imap";
export type ConnectorCapability = "list-email" | "save-draft" | "send-email" | "classify-email" | "create-message";

export interface EmailConnector {
  id: string;
  name: string;
  kind: ConnectorKind;
  capabilities: ConnectorCapability[];
  connect?: () => { status: string; url: string | null };
  listEmails?: () => Promise<Array<Record<string, unknown>>>;
  saveDraft?: (msg: Record<string, unknown>) => Promise<Record<string, unknown>>;
  sendEmail?: (msg: Record<string, unknown>) => Promise<never>;
}

export interface ConnectorCredential {
  connectorId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
  mock: boolean;
  status: string;
  connectedAt: string;
}

export interface ConnectorRegistry {
  connectors: Map<string, EmailConnector>;
  register: (connector: EmailConnector) => EmailConnector;
  get: (id: string) => EmailConnector;
  list: () => EmailConnector[];
}

export const CONNECTOR_KINDS: ConnectorKind[];
export const CONNECTOR_CAPABILITIES: ConnectorCapability[];

export function createConnectorRegistry(): ConnectorRegistry;
export function defineConnector(def: Record<string, unknown>): EmailConnector;
export function mockOAuthUrl(connectorId: string): string;
export function mockExchangeCode(connectorId: string, code: string): ConnectorCredential;
export function isMockCredential(cred: ConnectorCredential): boolean;
export function saveConnectorCredentials(root: string, credential: ConnectorCredential): Promise<{ ok: true; connectorId: string; stored: ConnectorCredential }>;
export function readConnectorCredentials(root: string, connectorId: string): Promise<ConnectorCredential | null>;
export function deleteConnectorCredentials(root: string, connectorId: string): Promise<{ ok: true; connectorId: string }>;
export function gmailConnector(): EmailConnector;
export function outlookConnector(): EmailConnector;
export function imapConnectorShape(): { kind: "imap"; capabilities: ConnectorCapability[]; connect: () => { status: string; url: null } };
export function defaultEmailRegistry(): ConnectorRegistry;
