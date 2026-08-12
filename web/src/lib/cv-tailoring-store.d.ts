/**
 * cv-tailoring-store.d.ts — Type declarations for cv-tailoring-store.mjs (FAS 3)
 */

import type { TailorLevel, TailorSection } from "./cv-tailoring.d.ts";

export interface TailorSessionSummary {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  level: TailorLevel;
  model: string;
  status: "draft" | "applied";
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  versionId: string | null;
  totalChanges: number;
  approvedCount: number;
  rejectedCount: number;
}

export interface TailorVersionRef {
  id: string;
  label: string;
  createdAt: string;
}

export interface TailorChangelogEntry {
  type: "created" | "decisions" | "applied" | "deleted";
  at: string;
  detail: string;
}

export interface TailorSession {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  level: TailorLevel;
  model: string;
  status: "draft" | "applied";
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  sections: TailorSection[];
  originalCv: string;
  proposedCv: string;
  approvedIds: string[];
  rejectedIds: string[];
  edits: Record<string, string>;
  version: TailorVersionRef | null;
  changelog: TailorChangelogEntry[];
}

export function tailorSessionId(jobId: string, level: TailorLevel, stamp?: number): string;
export function listTailorSessions(root: string): Promise<TailorSessionSummary[]>;
export function readTailorSession(root: string, id: string): Promise<TailorSession | null>;
export function saveTailorSession(root: string, session: TailorSession): Promise<TailorSession>;
export function deleteTailorSession(root: string, id: string): Promise<void>;
export function createTailorSession(options: {
  root: string;
  session: {
    id: string;
    jobId: string;
    jobTitle: string;
    company: string;
    level: TailorLevel;
    model?: string;
  };
  sections: TailorSection[];
  originalCv: string;
  proposedCv: string;
}): Promise<TailorSession>;
