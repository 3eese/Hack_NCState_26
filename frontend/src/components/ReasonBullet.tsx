import { cn } from "@/lib/utils";

type ReasonTag = "Source" | "Consistency" | "Scam" | "PII" | "Links" | "Domain" | "Urgency";

interface ReasonBulletProps {
  text: string;
  tag: ReasonTag;
  positive?: boolean;
}

const tagColors: Record<ReasonTag, string> = {
  Source: "bg-chip text-chip-foreground",
  Consistency: "bg-chip text-chip-foreground",
  Scam: "bg-destructive/15 text-destructive",
  PII: "bg-warning/15 text-warning",
  Links: "bg-chip text-chip-foreground",
  Domain: "bg-chip text-chip-foreground",
  Urgency: "bg-destructive/15 text-destructive",
};

export const ReasonBullet = ({ text, tag, positive }: ReasonBulletProps) => {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className={cn("mt-0.5 w-1.5 h-1.5 rounded-full shrink-0", positive ? "bg-score-high" : "bg-score-low")} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/90 leading-relaxed">{text}</p>
      </div>
      <span className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0", tagColors[tag])}>
        {tag}
      </span>
    </div>
  );
};
