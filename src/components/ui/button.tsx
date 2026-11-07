import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-[18px] [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary-hover",
        success: "bg-success text-white hover:bg-emerald-600",
        outline: "border border-line bg-white text-ink hover:bg-slate-50",
        ghost: "text-ink hover:bg-slate-100",
        dark: "bg-white/10 text-white hover:bg-white/20 border border-white/15",
        destructive: "bg-danger text-white hover:bg-red-600",
      },
      size: {
        default: "h-11 px-4 text-[15px]",
        sm: "h-9 px-3 text-sm",
        lg: "h-14 px-6 text-[17px]",
        xl: "h-16 px-8 text-[19px]",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { buttonVariants };
