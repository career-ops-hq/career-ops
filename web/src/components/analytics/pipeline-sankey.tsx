import { buildPipelineSankey, layoutSankey } from "@/lib/pipeline-sankey.mjs";
import { cn } from "@/lib/cn";

const TONE_NODE: Record<string, string> = {
  success: "fill-emerald-500",
  danger: "fill-red-400",
  info: "fill-sky-500",
  warn: "fill-amber-400",
  muted: "fill-zinc-400 dark:fill-zinc-500",
  neutral: "fill-brand",
};

const TONE_LINK: Record<string, string> = {
  success: "fill-emerald-500/30",
  danger: "fill-red-400/30",
  info: "fill-sky-500/30",
  warn: "fill-amber-400/30",
  muted: "fill-zinc-400/30",
  neutral: "fill-brand/30",
};

type AppRow = { n: string; status: string };
type LogRow = { num: number; from: string; to: string };

export function PipelineSankey({
  applications,
  statusLog,
}: {
  applications: AppRow[];
  statusLog: LogRow[];
}) {
  if (applications.length === 0) return null;

  const graph = buildPipelineSankey(applications, statusLog);
  const layout = layoutSankey(graph, { width: 920, height: 440, padding: { top: 24, right: 188, bottom: 24, left: 100 } });
  const toneById = new Map(layout.nodes.map((n) => [n.id, n.tone]));
  const labelById = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const firstRank = Math.min(...layout.nodes.map((n) => n.rank));
  const lastRank = Math.max(...layout.nodes.map((n) => n.rank));

  return (
    <section id="pipeline-sankey" className="mt-10 scroll-mt-8" aria-labelledby="sankey-heading">
      <h2 id="sankey-heading" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
        Pipeline Sankey
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Current tracker snapshot. Status-log transitions keep interview-then-reject
        on the interview path — a later Rejected does not erase the stage.
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface/50 p-3">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="h-auto w-full min-w-[720px]"
          role="img"
          aria-labelledby="sankey-title sankey-desc"
        >
          <title id="sankey-title">Application pipeline Sankey</title>
          <desc id="sankey-desc">
            {graph.total} tracked roles flowing from tracked through submitted to waiting,
            company-engaged, and terminal outcomes.
          </desc>

          {layout.links.map((link) => {
            const tone = toneById.get(link.source) ?? "neutral";
            const sourceLabel = labelById.get(link.source) ?? link.source;
            const targetLabel = labelById.get(link.target) ?? link.target;
            return (
              <g key={`${link.source}-${link.target}`} tabIndex={0} aria-label={`${link.value} from ${sourceLabel} to ${targetLabel}`}>
                <title>{`${link.value} roles: ${sourceLabel} → ${targetLabel}`}</title>
                <path d={link.d} className={cn(TONE_LINK[tone] ?? TONE_LINK.neutral, "outline-none")} />
              </g>
            );
          })}

          {layout.nodes.map((node) => {
            const short = node.height < 28;
            const labelOnRight =
              node.rank === lastRank || (node.rank !== firstRank && !(node.rank === 1 && short));
            const lx = labelOnRight ? node.x + node.width + 10 : node.x - 10;
            const anchor = labelOnRight ? "start" : "end";
            return (
              <g key={node.id} tabIndex={0} aria-label={`${node.label}: ${node.value} roles`}>
                <title>{`${node.label}: ${node.value}`}</title>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={Math.max(node.height, 2)}
                  rx={3}
                  className={TONE_NODE[node.tone] ?? TONE_NODE.neutral}
                />
                <text
                  x={lx}
                  y={node.y + node.height / 2}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  className="fill-foreground text-[11px] font-medium"
                  stroke="var(--bg)"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  {node.label}
                  <tspan className="fill-muted font-normal" stroke="var(--bg)" strokeWidth={4} paintOrder="stroke">
                    {`  ${node.value}`}
                  </tspan>
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <table className="sr-only">
        <caption>Pipeline Sankey flows</caption>
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>Roles</th>
          </tr>
        </thead>
        <tbody>
          {graph.links.map((link) => (
            <tr key={`${link.source}-${link.target}`}>
              <td>{labelById.get(link.source) ?? link.source}</td>
              <td>{labelById.get(link.target) ?? link.target}</td>
              <td>{link.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
