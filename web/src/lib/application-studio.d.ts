/**
 * application-studio.d.ts — Type declarations for application-studio.mjs (FAS 5)
 */

export type MessageTypeId =
  | "cover-letter"
  | "short-motivation"
  | "why-good-fit"
  | "recruiter-message"
  | "linkedin-message"
  | "email-application"
  | "follow-up"
  | "interview-confirmation"
  | "thank-you"
  | "faq-answers";

export type MessageLength = "short" | "standard" | "detailed";
export type MessageStyle = "professional" | "human" | "technical" | "leadership" | "sales";
export type MessageLanguage = "sv" | "en" | "auto";

export interface MessageTypeInfo {
  id: MessageTypeId;
  label: string;
  category: "brev" | "meddelande" | "uppföljning" | "frågor";
}

export interface StudioSettings {
  length: MessageLength;
  style: MessageStyle;
  language: MessageLanguage;
}

export interface FactRef {
  key: string;
  label: string;
  value: string;
  source: string;
}

export interface MessageVersion {
  version: number;
  body: string;
  editedAt: string;
  by: "ai" | "user";
}

export interface StudioMessage {
  id: string;
  type: MessageTypeId;
  title: string;
  subject?: string;
  body: string;
  factsUsed: FactRef[];
  missingFacts: string[];
  settings: StudioSettings;
  version: number;
  versions: MessageVersion[];
  draft: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudioProfile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  portfolio: string;
  headline: string;
  summary: string;
  targetRoles: string[];
  skills: string[];
  workModes: string[];
}

export interface StudioJob {
  id: string;
  company: string;
  role: string;
  location: string;
  url: string;
  source: string;
  language?: string;
  [key: string]: unknown;
}

export interface StudioMatch {
  score: number;
  strengths: string[];
  gaps: string[];
  matchedSkills: string[];
  [key: string]: unknown;
}

export interface StudioCvVersion {
  id: string;
  title?: string;
  text?: string;
  [key: string]: unknown;
}

export interface StudioPackage {
  packageId: string;
  job: StudioJob | null;
  profileSnapshot: StudioProfile | null;
  match: StudioMatch | null;
  cvVersion: StudioCvVersion | null;
  settings: StudioSettings;
  messages: StudioMessage[];
  status: string;
  history: Array<{ at: string; event: string; status: string; [key: string]: unknown }>;
  createdAt: string;
  updatedAt: string;
}

export declare const MESSAGE_TYPES: MessageTypeInfo[];
export declare const LENGTHS: MessageLength[];
export declare const STYLES: MessageStyle[];
export declare const LANGUAGES: MessageLanguage[];

export declare function resolveLanguage(language: MessageLanguage, job?: StudioJob | null, profile?: StudioProfile | null): "sv" | "en";

export declare function buildFactBase(input: {
  profile: StudioProfile | null;
  job: StudioJob | null;
  match: StudioMatch | null;
  cvVersion?: StudioCvVersion | null;
}): FactRef[];

export declare function generateMessage(input: {
  profile: StudioProfile | null;
  job: StudioJob | null;
  match: StudioMatch | null;
  cvVersion?: StudioCvVersion | null;
  settings: StudioSettings;
  type: MessageTypeId;
  now?: string;
}): StudioMessage;

export declare function generateMessages(input: {
  profile: StudioProfile | null;
  job: StudioJob | null;
  match: StudioMatch | null;
  cvVersion?: StudioCvVersion | null;
  settings: StudioSettings;
  types?: MessageTypeId[];
  now?: string;
}): StudioMessage[];

export declare function verifyMessageFacts(message: StudioMessage, facts: FactRef[]): {
  ok: boolean;
  unresolved: string[];
  unverifiedClaims: string[];
};

export declare function regenerateMessage(
  message: StudioMessage,
  input: {
    profile: StudioProfile | null;
    job: StudioJob | null;
    match: StudioMatch | null;
    cvVersion?: StudioCvVersion | null;
    settings: StudioSettings;
    now?: string;
  }
): StudioMessage;

export declare function editMessage(message: StudioMessage, body: string, now?: string): StudioMessage;

export declare function restoreMessageVersion(message: StudioMessage, versionNumber: number, now?: string): StudioMessage;

export declare function setMessageDraft(message: StudioMessage, draft: boolean, now?: string): StudioMessage;

export declare function copyMessage(message: StudioMessage): string;

export declare function createApplicationPackage(input: {
  job: StudioJob;
  profile: StudioProfile;
  match?: StudioMatch | null;
  cvVersion?: StudioCvVersion | null;
  settings: StudioSettings;
  types?: MessageTypeId[];
  messages?: StudioMessage[];
  facts?: FactRef[];
  now?: string;
}): StudioPackage;
