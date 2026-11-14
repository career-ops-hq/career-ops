import { cn } from "@/lib/cn";

export const pageFrameWidthClass = {
  default: "max-w-6xl",
  wide: "max-w-[1800px]",
} as const;

export type PageFrameWidth = keyof typeof pageFrameWidthClass;

const framePad = "mx-auto px-4 py-6 sm:px-6 sm:py-8 max-sm:pb-24";

/** `wide` is for tables and lists. Reading pages stay on the default cap. */
export function PageFrame({
  children,
  className,
  width = "default",
}: {
  children: React.ReactNode;
  className?: string;
  width?: PageFrameWidth;
}) {
  return <div className={cn(framePad, pageFrameWidthClass[width], className)}>{children}</div>;
}
