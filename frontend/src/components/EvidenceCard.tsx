import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface EvidenceCardProps {
  title: string;
  domain: string;
  snippet: string;
  url: string;
  className?: string;
}

export const EvidenceCard = ({ title, domain, snippet, url, className }: EvidenceCardProps) => {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "block rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:glow-primary group",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {title}
          </p>
          <p className="text-xs text-primary/70 mt-0.5 font-medium">{domain}</p>
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">{snippet}</p>
        </div>
        <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
      </div>
    </a>
  );
};
