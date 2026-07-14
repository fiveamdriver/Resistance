import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[rgba(var(--overlay-rgb),0.06)] text-[var(--fg-muted)]",
        outline: "border-[rgba(var(--overlay-rgb),0.15)] text-[#6b7280] bg-transparent",
        secondary: "border-transparent bg-[rgba(var(--overlay-rgb),0.04)] text-[var(--fg-muted)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
