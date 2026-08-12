/**
 * email-intelligence.d.ts — Type declarations for email-intelligence.mjs (FAS 5)
 */

export type EmailClassId =
  | "job-alert"
  | "recruiter-message"
  | "application-confirmation"
  | "interview"
  | "assessment-test"
  | "follow-up"
  | "rejection"
  | "offer"
  | "other";

export interface EmailClassification {
  classId: EmailClassId;
  label: string;
  confidence: number;
  reasons: string[];
}

export interface EmailEntities {
  company: string | null;
  role: string | null;
  recruiter: string | null;
  date: string | null;
  deadline: string | null;
  meetingTime: string | null;
  nextAction: string | null;
}

export interface EmailInput {
  id?: string;
  from?: string;
  fromName?: string;
  subject: string;
  body?: string;
  date?: string;
}

export interface PipelineJobLike {
  id: string;
  company: string;
  role: string;
  [key: string]: unknown;
}

export declare const EMAIL_CLASSES: Array<{ id: EmailClassId; label: string; keywords: string[] }>;

export declare function classifyEmail(email: EmailInput): EmailClassification;

export declare function extractEmailEntities(email: EmailInput): EmailEntities;

export declare function matchEmailToJob(
  email: EmailInput,
  jobs: PipelineJobLike[],
): { match: PipelineJobLike | null; confidence: number; needsUserConfirmation: boolean; reasons: string[] };
