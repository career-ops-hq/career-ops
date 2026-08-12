export interface CareerMasterProfile {
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

export function readCareerMasterProfile(root: string, options?: { profileFile?: string }): Promise<CareerMasterProfile>;
export function saveCareerMasterProfile(root: string, input: Partial<CareerMasterProfile>, options?: { profileFile?: string }): Promise<CareerMasterProfile>;
