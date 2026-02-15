import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface AnalysisStep {
  label: string;
  durationLabel?: string;
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
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-sharp text-xs font-bold transition-all",
            step.status === "done" && "bg-brass text-noir-base",
            step.status === "active" && "bg-brass/20 text-brass",
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
          <div className="flex-1 flex items-center justify-between gap-3 min-w-0">
            <span className={cn(
              "text-sm font-medium transition-colors truncate",
              step.status === "done" && "text-brass",
              step.status === "active" && "text-foreground",
              step.status === "pending" && "text-muted-foreground"
            )}>
              {step.label}
            </span>
            {step.durationLabel ? (
              <span className="text-xs font-semibold text-muted-foreground shrink-0 tabular-nums">
                {step.durationLabel}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
};
