import { cn } from "@/lib/utils";

type ReasonTag = "Source" | "Consistency" | "Scam" | "PII" | "Links" | "Domain" | "Urgency";

interface ReasonBulletProps {
  text: string;
  tag: ReasonTag;
  positive?: boolean;
}

const tagColors: Record<ReasonTag, string> = {
  Source: "bg-chip text-chip-foreground border border-white/10",
  Consistency: "bg-chip text-chip-foreground border border-white/10",
  Scam: "chip-danger",
  PII: "chip-warning",
  Links: "bg-chip text-chip-foreground border border-white/10",
  Domain: "bg-chip text-chip-foreground border border-white/10",
  Urgency: "chip-danger",
};

export const ReasonBullet = ({ text, tag, positive }: ReasonBulletProps) => {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className={cn("mt-0.5 w-1.5 h-1.5 rounded-full shrink-0", positive ? "bg-score-high" : "bg-score-low")} />
      <div className="flex-1 min-w-0">
        <p className="break-words text-sm leading-relaxed text-foreground/90">{text}</p>
      </div>
      <span className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sharp shrink-0", tagColors[tag])}>
        {tag}
      </span>
    </div>
  );
};
