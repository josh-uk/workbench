import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-accent-foreground shadow-sm hover:brightness-105",
        secondary:
          "border bg-surface text-foreground shadow-sm hover:bg-surface-subtle",
        ghost: "text-muted hover:bg-surface-subtle hover:text-foreground",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-2.5 text-xs",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({
  asChild = false,
  className,
  size,
  variant,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";

  return (
    <Component
      className={cn(buttonVariants({ size, variant }), className)}
      {...props}
    />
  );
}
