"use client";
import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d558a] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[#2d558a] text-white hover:bg-[#1e3d6b] shadow-[0_0_20px_rgba(45,85,138,0.25)]",
        outline:
          "border border-[#1a3252] bg-transparent text-white hover:bg-[#0a1628] hover:border-[rgba(45,85,138,0.4)]",
        ghost: "bg-transparent text-[#94a3b8] hover:bg-[#0a1628] hover:text-white",
        secondary:
          "bg-[#0d1f3c] text-[#2d558a] border border-[#1a3252] hover:bg-[#152038]",
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
