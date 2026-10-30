export type SankeyApp = { n: string | number; status: string };
export type SankeyLogRow = { num: number; from: string; to: string };
export type SankeyNode = {
  id: string;
  label: string;
  rank: number;
  tone: string;
  value: number;
};
export type SankeyLink = { source: string; target: string; value: number };
export type SankeyGraph = { nodes: SankeyNode[]; links: SankeyLink[]; total: number };
export type SankeyLayoutOpts = {
  width?: number;
  height?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  nodeWidth?: number;
  nodeGap?: number;
};
export type LaidSankeyNode = SankeyNode & { x: number; y: number; width: number; height: number };
export type LaidSankeyLink = SankeyLink & { d: string; thickness: number };

export const NODE_DEFS: Omit<SankeyNode, "value">[];

export function statusToken(raw: string): string;
export function parseStatusLog(
  tsv: string,
): Array<{ num: number; date: string; from: string; to: string; source: string; note: string }>;
export function classifyLeaf(app: SankeyApp, log: SankeyLogRow[]): string;
export function buildPipelineSankey(apps: SankeyApp[], log?: SankeyLogRow[]): SankeyGraph;
export function layoutSankey(
  graph: Pick<SankeyGraph, "nodes" | "links">,
  opts?: SankeyLayoutOpts,
): { nodes: LaidSankeyNode[]; links: LaidSankeyLink[]; width: number; height: number; scale: number };
