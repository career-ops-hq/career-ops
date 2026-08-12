/**
 * application-pipeline.d.ts — Type declarations for application-pipeline.mjs (FAS 5)
 */

export type PipelineStatusId =
  | "Saved"
  | "Preparing"
  | "Ready to Apply"
  | "Applied"
  | "Recruiter Contact"
  | "Interview"
  | "Assessment"
  | "Offer"
  | "Rejected"
  | "Withdrawn";

export interface PipelineStatusDef {
  id: PipelineStatusId;
  label: string;
  description: string;
}

export interface PipelineHistoryEntry {
  at: string;
  event: string;
  status?: string;
  from?: string;
  to?: string;
  messageId?: string;
  version?: number;
}

export interface PipelinePackageLike {
  packageId?: string | null;
  status?: string;
  history?: PipelineHistoryEntry[];
  updatedAt?: string;
  [key: string]: unknown;
}

export const PIPELINE_STATUSES: PipelineStatusDef[];

export function isPipelineStatus(value: string): value is PipelineStatusId;

export function nextPipelineStatuses(status: string): PipelineStatusId[];

/** Returns a NEW package (immutability). Throws on illegal transition. */
export function transitionPipeline<T extends PipelinePackageLike>(pkg: T, toStatus: PipelineStatusId, now?: string): T;

/** Map a FAS 5 status to the existing core pipeline status for display. */
export function toCoreStatus(status: PipelineStatusId): string;
