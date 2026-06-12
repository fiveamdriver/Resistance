"use client";
import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[#00ff88] text-[#050505] hover:bg-[#00cc70] shadow-[0_0_20px_rgba(0,255,136,0.25)]",
        outline:
          "border border-[#1e3a2a] bg-transparent text-white hover:bg-[#0a1a0a] hover:border-[rgba(0,255,136,0.4)]",
        ghost: "bg-transparent text-[#94a3b8] hover:bg-[#0a1a0a] hover:text-white",
        secondary:
          "bg-[#0f1f0f] text-[#00ff88] border border-[#1e3a2a] hover:bg-[#1a2a1a]",
      },
      size: {
        default: "h-10 px-4 py-2",
        lg: "h-12 px-8 text-base",
        sm: "h-8 px-3 text-xs",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
