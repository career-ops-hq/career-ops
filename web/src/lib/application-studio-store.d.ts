/**
 * application-studio-store.d.ts — Type declarations for application-studio-store.mjs (FAS 5)
 */

import type { StudioPackage, StudioSettings, StudioProfile, StudioJob, StudioMatch, StudioCvVersion } from "./application-studio.d.ts";

export declare function summarizePackage(pkg: StudioPackage): Record<string, unknown>;

export declare function listPackages(root: string): Promise<Array<Record<string, unknown>>>;

export declare function getPackage(root: string, packageId: string): Promise<StudioPackage | null>;

export declare function savePackage(root: string, pkg: StudioPackage): Promise<StudioPackage>;

export declare function createPackage(
  root: string,
  data: {
    job?: StudioJob | null;
    profileSnapshot?: StudioProfile | null;
    match?: StudioMatch | null;
    cvVersion?: StudioCvVersion | null;
    settings?: StudioSettings;
  },
): Promise<StudioPackage>;

export declare function updatePackage(
  root: string,
  packageId: string,
  patchFn: (pkg: StudioPackage) => StudioPackage,
): Promise<StudioPackage>;

export declare function archivePackage(root: string, packageId: string): Promise<string>;
