import { cn } from "@/lib/cn";

// Panel with the docs home signature: a resting rotating brand-gradient corner
// that lights the 1px edge (bg-origin-border). Both opt-in — dense work
// surfaces (tables, lists) pass neither corner nor elevated.
const CORNERS = {
  br: "bg-gradient-to-br",
  bl: "bg-gradient-to-bl",
  tr: "bg-gradient-to-tr",
  tl: "bg-gradient-to-tl",
} as const;

export function Card({
  className,
  corner,
  elevated,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  corner?: keyof typeof CORNERS;
  elevated?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-surface/50 p-5",
        corner && `${CORNERS[corner]} from-brand/10 via-transparent to-transparent bg-origin-border`,
        elevated && "shadow-lg",
        className,
      )}
      {...props}
    />
  );
}
