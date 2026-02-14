import { cn } from "@/lib/utils";

interface ScoreGaugeProps {
  score: number;
  size?: number;
  label?: string;
  className?: string;
}

const getScoreColor = (score: number) => {
  if (score >= 75) return "text-score-high";
  if (score >= 40) return "text-score-medium";
  return "text-score-low";
};

const getScoreStroke = (score: number) => {
  if (score >= 75) return "stroke-score-high";
  if (score >= 40) return "stroke-score-medium";
  return "stroke-score-low";
};

const getVerdict = (score: number, mode: "verify" | "protect" = "verify") => {
  if (mode === "verify") {
    if (score >= 75) return "Likely Real";
    if (score >= 40) return "Unverified";
    return "Likely Fake";
  }
  if (score >= 65) return "High Risk";
  if (score >= 35) return "Medium Risk";
  return "Low Risk";
};

export const ScoreGauge = ({ score, size = 160, label, className }: ScoreGaugeProps) => {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth="6"
            className="stroke-muted"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn("transition-all duration-1000 ease-out", getScoreStroke(score))}
            style={{ "--score-offset": offset } as React.CSSProperties}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-4xl font-bold tabular-nums", getScoreColor(score))}>
            {score}
          </span>
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            / 100
          </span>
        </div>
      </div>
      {label && (
        <span className={cn("text-sm font-semibold uppercase tracking-wide", getScoreColor(score))}>
          {label}
        </span>
      )}
    </div>
  );
};

export { getVerdict, getScoreColor };
