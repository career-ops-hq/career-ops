import { cn } from "@/lib/cn";

/** Shared application frame used by list, detail and analytics surfaces. */
export function PageFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 max-sm:pb-24", className)}>{children}</div>;
}
