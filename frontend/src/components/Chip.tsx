import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

const variants = {
  default: "bg-chip text-chip-foreground",
  success: "bg-primary/15 text-primary",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
};

export const Chip = ({ children, variant = "default", className }: ChipProps) => {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider",
      variants[variant],
      className
    )}>
      {children}
    </span>
  );
};
