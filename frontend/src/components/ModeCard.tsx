import { cn } from "@/lib/utils";
import { ArrowRight, ChevronRight, Shield, Search } from "lucide-react";

interface ModeCardProps {
  mode: "verify" | "protect";
  selected?: boolean;
  onClick: () => void;
}

export const ModeCard = ({ mode, selected, onClick }: ModeCardProps) => {
  const isVerify = mode === "verify";
  const title = isVerify ? "Verify" : "Protect";
  const description = isVerify
    ? "Investigate claims, screenshots, and URLs for misinformation before it spreads."
    : "Scan messages and links for identity threats, phishing markers, and privacy risk.";
  const features = isVerify
    ? ["Fact-check text claims", "Analyze screenshot context", "Trace URL credibility"]
    : ["Detect phishing patterns", "Flag PII exposure", "Surface tracker risk"];

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative group w-full overflow-hidden rounded-sharp border p-7 text-left transition-all duration-500 ease-noir",
        selected
          ? "border-brass bg-noir-card shadow-noir-lg"
          : "border-white/10 bg-noir-card/90 hover:border-brass/40 hover:shadow-noir-lg"
      )}
    >
      <div className={cn("absolute left-0 right-0 top-0 h-[3px]", isVerify ? "bg-brass" : "bg-emerald-safe")} />

      <div
        className={cn(
          "w-14 h-14 rounded-sharp mb-5 flex items-center justify-center transition-all duration-300",
          isVerify
            ? "bg-brass/10 text-brass group-hover:shadow-glow"
            : "bg-emerald-safe/10 text-emerald-safe group-hover:shadow-[0_0_20px_rgba(16,185,129,0.25)]"
        )}
      >
        {isVerify ? (
          <Search className="w-7 h-7" />
        ) : (
          <Shield className="w-7 h-7" />
        )}
      </div>

      <h3 className="font-display text-3xl font-semibold tracking-tight text-foreground">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>

      <ul className="mt-5 space-y-2">
        {features.map((feature) => (
          <li key={feature} className="flex items-center gap-2 text-xs text-muted-foreground">
            <ChevronRight className={cn("h-4 w-4", isVerify ? "text-brass" : "text-emerald-safe")} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div
        className={cn(
          "mt-6 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] transition-all duration-300 group-hover:gap-3",
          isVerify ? "text-brass" : "text-emerald-safe"
        )}
      >
        <span>Begin Investigation</span>
        <ArrowRight className="h-4 w-4" />
      </div>

      {selected && (
        <div className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-brass animate-pulse-glow" />
      )}
    </button>
  );
};
