/**
 * email-hub-store.d.ts — Type declarations for email-hub-store.mjs (FAS 5)
 */

import type { EmailClassification, EmailEntities, PipelineJobLike } from "./email-intelligence.d.ts";

export interface StoredEmail {
  id: string;
  connectorId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  classification: EmailClassification;
  entities: EmailEntities;
  jobLink: {
    jobId: string | null;
    company?: string | null;
    role?: string | null;
    confidence: number;
    needsUserConfirmation: boolean;
    reasons: string[];
    candidates?: Array<{ jobId: string; company: string; role: string }>;
  } | null;
  actions: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

export declare function summarizeMessage(rec: StoredEmail): Record<string, unknown>;

export declare function listMessages(root: string): Promise<Array<Record<string, unknown>>>;

export declare function getMessage(root: string, id: string): Promise<StoredEmail | null>;

export declare function ingestEmail(
  root: string,
  email: { id?: string; from?: string; fromName?: string; to?: string; subject: string; body?: string; date?: string },
  jobs?: PipelineJobLike[],
  opts?: { connectorId?: string; linkJobId?: string },
): Promise<StoredEmail>;

export declare function updateJobLink(root: string, id: string, jobId: string | null, jobs: PipelineJobLike[]): Promise<StoredEmail>;

export declare function recordAction(root: string, id: string, action: Record<string, unknown>): Promise<StoredEmail>;

export declare function deleteMessage(root: string, id: string): Promise<StoredEmail | null>;
