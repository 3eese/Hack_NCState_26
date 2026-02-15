import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

const variants = {
  default: "bg-chip text-chip-foreground border border-white/10",
  success: "chip-safe",
  warning: "chip-warning",
  danger: "chip-danger",
};

export const Chip = ({ children, variant = "default", className }: ChipProps) => {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-3 py-1 rounded-sharp text-xs font-semibold uppercase tracking-wider",
      variants[variant],
      className
    )}>
      {children}
    </span>
  );
};
