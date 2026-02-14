import { cn } from "@/lib/utils";
import { Shield, Search } from "lucide-react";

interface ModeCardProps {
  mode: "verify" | "protect";
  selected?: boolean;
  onClick: () => void;
}

export const ModeCard = ({ mode, selected, onClick }: ModeCardProps) => {
  const isVerify = mode === "verify";

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full rounded-xl border p-6 text-left transition-all duration-300 group cursor-pointer",
        selected
          ? "border-primary/50 bg-accent glow-primary"
          : "border-border bg-card hover:border-primary/20 hover:bg-accent/50"
      )}
    >
      <div className={cn(
        "w-12 h-12 rounded-lg flex items-center justify-center mb-4 transition-colors",
        selected ? "bg-primary/20" : "bg-muted"
      )}>
        {isVerify ? (
          <Search className={cn("w-6 h-6", selected ? "text-primary" : "text-muted-foreground")} />
        ) : (
          <Shield className={cn("w-6 h-6", selected ? "text-primary" : "text-muted-foreground")} />
        )}
      </div>
      <h3 className="text-lg font-bold font-display text-foreground mb-1">
        {isVerify ? "Verify" : "Protect"}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {isVerify
          ? "Check if a claim or announcement is backed by public evidence."
          : "Detect PII exposure and scam/phishing risks in messages."}
      </p>
      {selected && (
        <div className="absolute top-4 right-4 w-3 h-3 rounded-full bg-primary animate-pulse-glow" />
      )}
    </button>
  );
};
