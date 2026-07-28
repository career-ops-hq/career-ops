import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

// Mirrors the career-ops-docs ui/button (cva) on app tokens. Docs CTAs are
// rounded-full pills; we down-tune controls to rounded-md for dashboard
// density and reserve the one rounded-full pill for the Today hero CTA
// (expressed inline, not a variant — avoids pill overuse).
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 max-sm:min-h-[44px]",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-foreground hover:bg-brand-200",
        outline: "border border-border bg-surface hover:bg-surface-hover hover:text-foreground",
        ghost: "hover:bg-surface-hover hover:text-foreground",
        secondary: "border border-border bg-surface text-foreground hover:bg-surface-hover",
      },
      size: { sm: "px-2 py-1.5 text-xs", icon: "p-1.5 max-sm:min-w-[44px]", default: "" },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export function Button({
  variant,
  size,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export type ButtonVariants = VariantProps<typeof buttonVariants>;
