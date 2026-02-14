import { useSearchParams, useNavigate } from "react-router-dom";
import { ScoreGauge, getVerdict, getScoreColor } from "@/components/ScoreGauge";
import { EvidenceCard } from "@/components/EvidenceCard";
import { ReasonBullet } from "@/components/ReasonBullet";
import { Chip } from "@/components/Chip";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { ArrowLeft, Zap, Copy, Share2, RotateCcw } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

// Mock data for demo
const verifyMock = {
  score: 82,
  reasons: [
    { text: "Claim corroborated by Reuters and AP News with matching details.", tag: "Source" as const, positive: true },
    { text: "Official domain nasa.gov referenced in original claim.", tag: "Domain" as const, positive: true },
    { text: "3 independent sources confirm the core facts.", tag: "Consistency" as const, positive: true },
    { text: "Date in claim matches official announcement timeline.", tag: "Source" as const, positive: true },
    { text: "No contradicting reports found in major outlets.", tag: "Consistency" as const, positive: true },
  ],
  evidence: [
    { title: "NASA Confirms New Artemis Mission Date", domain: "reuters.com", snippet: "NASA announced the updated Artemis III mission timeline, confirming a 2026 launch window...", url: "#" },
    { title: "Artemis Program Update - Official Statement", domain: "nasa.gov", snippet: "The agency today released revised mission parameters for the Artemis III crewed lunar landing...", url: "#" },
    { title: "Space agency updates moon mission schedule", domain: "apnews.com", snippet: "In a press briefing, NASA officials outlined changes to the Artemis program timeline...", url: "#" },
  ],
  nextSteps: [
    "This claim appears well-supported by official and reputable sources.",
    "Cross-reference with NASA's official press releases for latest updates.",
    "Share the official source links rather than screenshots for accuracy.",
  ],
};

const protectMock = {
  score: 78,
  reasons: [
    { text: "Message requests immediate action on account credentials.", tag: "Urgency" as const, positive: false },
    { text: "Sender domain doesn't match official PayPal domain.", tag: "Domain" as const, positive: false },
    { text: "Contains shortened URL that redirects to unknown host.", tag: "Links" as const, positive: false },
    { text: "Email address detected: j***@gmail.com", tag: "PII" as const, positive: false },
    { text: "Payment-related language with gift card request.", tag: "Scam" as const, positive: false },
  ],
  piiItems: [
    { type: "Email", masked: "j****@gmail.com" },
    { type: "Phone", masked: "(555) ***-**89" },
  ],
  nextSteps: [
    "Do NOT click any links in this message.",
    "Go directly to paypal.com by typing it in your browser.",
    "Report this message as phishing to your email provider.",
    "If you clicked any links, change your PayPal password immediately.",
    "Enable two-factor authentication on your PayPal account.",
  ],
};

const Results = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mode = (searchParams.get("mode") as "verify" | "protect") || "verify";
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);

  const data = mode === "verify" ? verifyMock : protectMock;
  const verdict = getVerdict(data.score, mode);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 600),
      setTimeout(() => setStep(2), 1400),
      setTimeout(() => { setStep(3); setLoading(false); }, 2200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const analysisSteps = [
    { label: "Extracting content...", status: step >= 1 ? "done" as const : step === 0 ? "active" as const : "pending" as const },
    { label: mode === "verify" ? "Searching sources..." : "Scanning for risks...", status: step >= 2 ? "done" as const : step === 1 ? "active" as const : "pending" as const },
    { label: "Scoring & generating report...", status: step >= 3 ? "done" as const : step === 2 ? "active" as const : "pending" as const },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <nav className="border-b border-border px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-base font-bold text-foreground">Zeda</span>
          </div>
        </nav>
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-xs w-full">
            <h2 className="text-xl font-bold font-display text-foreground mb-6">Analyzing...</h2>
            <AnalysisProgress steps={analysisSteps} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-base font-bold text-foreground">Zeda</span>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <Chip variant={mode === "verify" ? "success" : "warning"}>
              {mode === "verify" ? "Verify" : "Protect"}
            </Chip>
          </div>
        </div>
      </nav>

      <main className="flex-1 px-6 py-8 max-w-2xl mx-auto w-full">
        {/* Score + Verdict */}
        <div className="flex flex-col items-center mb-8 animate-fade-up">
          <Chip
            variant={data.score >= 75 && mode === "verify" ? "success" : data.score < 40 && mode === "verify" ? "danger" : mode === "protect" && data.score >= 65 ? "danger" : "warning"}
            className="mb-4"
          >
            {verdict}
          </Chip>
          <ScoreGauge score={data.score} label={mode === "verify" ? "Confidence" : "Risk Level"} />
        </div>

        {/* Reasons */}
        <section className="mb-8 animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">Key Findings</h3>
          <div className="rounded-xl border border-border bg-card p-4 divide-y divide-border">
            {data.reasons.map((r, i) => (
              <ReasonBullet key={i} text={r.text} tag={r.tag} positive={r.positive} />
            ))}
          </div>
        </section>

        {/* PII (Protect mode) */}
        {mode === "protect" && "piiItems" in data && (
          <section className="mb-8 animate-fade-up" style={{ animationDelay: "0.15s" }}>
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">PII Detected</h3>
            <div className="flex flex-wrap gap-2">
              {data.piiItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                  <Chip variant="warning">{item.type}</Chip>
                  <span className="text-sm font-mono text-muted-foreground">{item.masked}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Evidence (Verify mode) */}
        {mode === "verify" && "evidence" in data && (
          <section className="mb-8 animate-fade-up" style={{ animationDelay: "0.2s" }}>
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">Evidence Sources</h3>
            <div className="space-y-3">
              {data.evidence.map((e, i) => (
                <EvidenceCard key={i} title={e.title} domain={e.domain} snippet={e.snippet} url={e.url} />
              ))}
            </div>
          </section>
        )}

        {/* Next Steps */}
        <section className="mb-8 animate-fade-up" style={{ animationDelay: "0.25s" }}>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">Recommended Next Steps</h3>
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            {data.nextSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-foreground/90 leading-relaxed">{step}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Actions */}
        <div className="flex gap-3 animate-fade-up" style={{ animationDelay: "0.3s" }}>
          <button
            onClick={() => navigate("/")}
            className="flex-1 py-3 rounded-xl font-semibold text-sm border border-border bg-card text-foreground hover:bg-accent transition-all flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            New Check
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(
                `Zeda ${mode === "verify" ? "Verification" : "Protection"} Report\nVerdict: ${verdict}\nScore: ${data.score}/100\n\nReasons:\n${data.reasons.map(r => `• ${r.text}`).join("\n")}`
              );
            }}
            className="flex-1 py-3 rounded-xl font-semibold text-sm bg-primary text-primary-foreground hover:glow-primary-strong transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            <Copy className="w-4 h-4" />
            Copy Receipt
          </button>
        </div>
      </main>
    </div>
  );
};

export default Results;
