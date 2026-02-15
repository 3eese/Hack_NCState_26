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
        "group block rounded-sharp border border-white/10 bg-noir-card p-4 transition-all duration-300 hover:border-brass/45 hover:shadow-noir-lg",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-brass">
            {title}
          </p>
          <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{domain}</p>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{snippet}</p>
        </div>
        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-brass" />
      </div>
    </a>
  );
};
