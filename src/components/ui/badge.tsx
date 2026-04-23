import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--primary-mu)] text-[var(--primary-tx)]",
        secondary:
          "border-transparent bg-[var(--bg-muted)] text-[var(--text-2)]",
        destructive:
          "border-transparent bg-[var(--status-error-bg)] text-[var(--status-error-tx)]",
        success:
          "border-transparent bg-[var(--status-success-bg)] text-[var(--status-success-tx)]",
        warning:
          "border-transparent bg-[var(--status-warning-bg)] text-[var(--status-warning-tx)]",
        info: "border-transparent bg-[var(--status-info-bg)] text-[var(--status-info-tx)]",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
