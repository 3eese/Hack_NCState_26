import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface AnalysisStep {
  label: string;
  status: "pending" | "active" | "done";
}

interface AnalysisProgressProps {
  steps: AnalysisStep[];
  className?: string;
}

export const AnalysisProgress = ({ steps, className }: AnalysisProgressProps) => {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className={cn(
            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all",
            step.status === "done" && "bg-primary text-primary-foreground",
            step.status === "active" && "bg-primary/20 text-primary",
            step.status === "pending" && "bg-muted text-muted-foreground"
          )}>
            {step.status === "active" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : step.status === "done" ? (
              "✓"
            ) : (
              i + 1
            )}
          </div>
          <span className={cn(
            "text-sm font-medium transition-colors",
            step.status === "done" && "text-primary",
            step.status === "active" && "text-foreground",
            step.status === "pending" && "text-muted-foreground"
          )}>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
};
