import { useSearchParams, useNavigate } from "react-router-dom";
import { ScoreGauge, getVerdict } from "@/components/ScoreGauge";
import { EvidenceCard } from "@/components/EvidenceCard";
import { ReasonBullet } from "@/components/ReasonBullet";
import { Chip } from "@/components/Chip";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { ArrowLeft, Copy, RotateCcw } from "lucide-react";
import { useState, useEffect } from "react";

type Mode = "verify" | "protect";
type InputType = "text" | "url" | "image";

type SubmissionPayload = {
  mode: Mode;
  inputType: InputType;
  content: string;
  createdAt: number;
};

type ApiEvidence = {
  title: string;
  url: string;
  snippet: string;
};

type ApiResultData = {
  mode: Mode;
  inputType: InputType;
  veracityIndex: number;
  verdict: string;
  summary: string;
  extractedText: string;
  keyFindings: string[];
  fakeParts: string[];
  recommendedActions: string[];
  evidenceSources: ApiEvidence[];
  model: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const getDomainFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown-source";
  }
};

const clampScore = (value: unknown, fallback = 50): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(num)));
};

const ensureStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const normalizeResultData = (raw: unknown, mode: Mode): ApiResultData => {
  const record = (raw ?? {}) as Record<string, unknown>;

  if (typeof record.veracityIndex === "number" || typeof record.veracityIndex === "string") {
    return {
      mode,
      inputType: (record.inputType as InputType) ?? "text",
      veracityIndex: clampScore(record.veracityIndex, 50),
      verdict: typeof record.verdict === "string" ? record.verdict : "",
      summary: typeof record.summary === "string" ? record.summary : "",
      extractedText: typeof record.extractedText === "string" ? record.extractedText : "",
      keyFindings: ensureStringArray(record.keyFindings),
      fakeParts: ensureStringArray(record.fakeParts),
      recommendedActions: ensureStringArray(record.recommendedActions),
      evidenceSources: Array.isArray(record.evidenceSources)
        ? (record.evidenceSources as ApiEvidence[]).filter((item) => item && typeof item.title === "string" && typeof item.url === "string" && typeof item.snippet === "string")
        : [],
      model: typeof record.model === "string" ? record.model : "unknown",
    };
  }

  const phishing = (record.phishingRisk ?? {}) as Record<string, unknown>;
  const pii = (record.piiRisk ?? {}) as Record<string, unknown>;
  const privacy = (record.privacyRisk ?? {}) as Record<string, unknown>;

  const phishingScore = clampScore(phishing.score, 0);
  const piiScore = clampScore(pii.score, 0);
  const privacyScore = clampScore(privacy.score, 0);
  const overall = clampScore(Math.round((phishingScore + piiScore + privacyScore) / 3), 50);

  const flags = Array.isArray(phishing.flags) ? phishing.flags as Array<Record<string, unknown>> : [];
  const lookalikes = Array.isArray(phishing.lookalikeMatches) ? phishing.lookalikeMatches as Array<Record<string, unknown>> : [];
  const detections = Array.isArray(pii.detections) ? pii.detections as Array<Record<string, unknown>> : [];
  const trackerMatches = Array.isArray(privacy.trackerMatches) ? privacy.trackerMatches as Array<Record<string, unknown>> : [];

  const keyFindings: string[] = [];
  if (flags.length > 0) {
    keyFindings.push(...flags.slice(0, 4).map((f) => `${String(f.type ?? "Risk")}: ${String(f.description ?? "Suspicious signal detected.")}`));
  }
  if (lookalikes.length > 0) {
    keyFindings.push(...lookalikes.slice(0, 3).map((m) => `Lookalike domain risk: ${String(m.hostname ?? m.url ?? "unknown host")}`));
  }
  if (detections.length > 0) {
    keyFindings.push(...detections.slice(0, 3).map((d) => `PII detected: ${String(d.type ?? "data")} (${String(d.count ?? 1)})`));
  }
  if (trackerMatches.length > 0) {
    keyFindings.push(`Tracker activity found across ${trackerMatches.length} resource match(es).`);
  }

  const fakeParts: string[] = [];
  fakeParts.push(...flags.slice(0, 3).map((f) => String(f.description ?? "Suspicious message pattern.")));
  fakeParts.push(...lookalikes.slice(0, 3).map((m) => String(m.reason ?? "Domain appears suspicious.")));

  const evidenceSources: ApiEvidence[] = trackerMatches
    .slice(0, 8)
    .map((m) => {
      const url = typeof m.resourceUrl === "string" ? m.resourceUrl : "";
      const domain = typeof m.trackerDomain === "string" ? m.trackerDomain : "tracker";
      return {
        title: `Tracker match: ${domain}`,
        url: url || "https://example.com",
        snippet: `Hostname: ${String(m.hostname ?? "unknown")} | Category: ${String(m.category ?? "unknown")}`,
      };
    })
    .filter((e) => e.url.startsWith("http"));

  const summary =
    `Phishing risk ${phishingScore}/100, PII risk ${piiScore}/100, privacy risk ${privacyScore}/100.` +
    (typeof pii.maskedText === "string" && pii.maskedText.trim().length > 0
      ? " Sensitive data was masked in detected text."
      : "");

  const recommendedActions = [
    "Do not click unknown links or share verification codes.",
    "Verify sender domains and website URLs via official channels.",
    "Use MFA and rotate passwords if you interacted with suspicious content.",
  ];

  return {
    mode: "protect",
    inputType: "text",
    veracityIndex: overall,
    verdict: overall >= 65 ? "High Risk" : overall >= 35 ? "Medium Risk" : "Low Risk",
    summary,
    extractedText: typeof pii.maskedText === "string" ? pii.maskedText : "",
    keyFindings: keyFindings.length > 0 ? keyFindings : ["No specific risk indicators returned."],
    fakeParts: fakeParts.length > 0 ? fakeParts : ["No explicit suspicious segment was identified."],
    recommendedActions,
    evidenceSources,
    model: "protect-heuristics",
  };
};

const Results = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mode = (searchParams.get("mode") as Mode) || "verify";
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResultData | null>(null);

  useEffect(() => {
    let mounted = true;
    const stepTimer = setInterval(() => {
      setStep((current) => (current < 2 ? current + 1 : current));
    }, 700);

    const fetchResult = async () => {
      try {
        const rawSubmission = sessionStorage.getItem("zeda:lastSubmission");
        if (!rawSubmission) {
          throw new Error("No submission found. Please submit an input first.");
        }

        const submission = JSON.parse(rawSubmission) as SubmissionPayload;
        if (!submission.content?.trim()) {
          throw new Error("Submission content is empty. Please try again.");
        }

        const endpoint = submission.mode === "protect" ? "protect" : "verify";
        const response = await fetch(`${API_BASE_URL}/api/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputType: submission.inputType,
            content: submission.content,
          }),
        });

        const payload = await response.json();
        if (!response.ok || payload.status !== "success") {
          throw new Error(payload.message || "Analysis failed.");
        }

        if (mounted) {
          setResult(normalizeResultData(payload.data, submission.mode));
        }
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : "Failed to run analysis.";
          setError(message);
        }
      } finally {
        if (mounted) {
          setStep(3);
          setLoading(false);
        }
      }
    };

    fetchResult();

    return () => {
      mounted = false;
      clearInterval(stepTimer);
    };
  }, []);

  const analysisSteps = [
    { label: "Extracting content...", status: step >= 1 ? "done" as const : step === 0 ? "active" as const : "pending" as const },
    { label: mode === "verify" ? "Verifying claims..." : "Scanning privacy/scam risk...", status: step >= 2 ? "done" as const : step === 1 ? "active" as const : "pending" as const },
    { label: "Scoring & generating report...", status: step >= 3 ? "done" as const : step === 2 ? "active" as const : "pending" as const },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <nav className="border-b border-border px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
              <img src="/zeda-logo.svg" alt="Zeda" className="w-3.5 h-3.5" />
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

  if (error || !result) {
    return (
      <div className="min-h-screen flex flex-col">
        <nav className="border-b border-border px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                  <img src="/zeda-logo.svg" alt="Zeda" className="w-3.5 h-3.5" />
                </div>
                <span className="text-base font-bold text-foreground">Zeda</span>
              </div>
            </button>
          </div>
        </nav>
        <main className="flex-1 px-6 py-8 max-w-2xl mx-auto w-full">
          <div className="rounded-xl border border-destructive/40 bg-card p-5">
            <h3 className="text-sm font-bold text-destructive uppercase tracking-wider mb-2">Analysis Error</h3>
            <p className="text-sm text-foreground/90">{error || "No analysis result available."}</p>
          </div>
        </main>
      </div>
    );
  }

  const score = result.veracityIndex;
  const verdict = result.verdict?.trim() || getVerdict(score, mode);
  const fakePartReasons = result.fakeParts.map((text) => ({
    text,
    tag: mode === "verify" ? "Consistency" : "Scam",
    positive: false,
  })) as Array<{ text: string; tag: "Consistency" | "Scam"; positive: boolean }>;

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                <img src="/zeda-logo.svg" alt="Zeda" className="w-3.5 h-3.5" />
              </div>
              <span className="text-base font-bold text-foreground">Zeda</span>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <Chip variant={mode === "verify" ? "success" : "warning"}>{mode === "verify" ? "Verify" : "Protect"}</Chip>
          </div>
        </div>
      </nav>

      <main className="flex-1 px-6 py-8 max-w-2xl mx-auto w-full">
        <div className="flex flex-col items-center mb-8 animate-fade-up">
          <Chip
            variant={score >= 75 && mode === "verify" ? "success" : score < 40 && mode === "verify" ? "danger" : mode === "protect" && score >= 65 ? "danger" : "warning"}
            className="mb-4"
          >
            {verdict}
          </Chip>
          <ScoreGauge score={score} label="Veracity Index" />
        </div>

        <section className="mb-8 animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">Summary</h3>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-foreground/90 leading-relaxed">
              {result.summary || "No summary returned by the model."}
            </p>
          </div>
        </section>

        <section className="mb-8 animate-fade-up" style={{ animationDelay: "0.14s" }}>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">Key Findings</h3>
          <div className="rounded-xl border border-border bg-card p-4 divide-y divide-border">
            {(result.keyFindings.length > 0 ? result.keyFindings : ["No key findings returned."]).map((finding, i) => (
              <ReasonBullet key={i} text={finding} tag="Source" positive={mode === "verify"} />
            ))}
          </div>
        </section>

        <section className="mb-8 animate-fade-up" style={{ animationDelay: "0.18s" }}>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">Potentially Fake Parts</h3>
          <div className="rounded-xl border border-border bg-card p-4 divide-y divide-border">
            {(fakePartReasons.length > 0 ? fakePartReasons : [{ text: "No suspicious sections were explicitly flagged.", tag: "Consistency" as const, positive: true }]).map((part, i) => (
              <ReasonBullet key={i} text={part.text} tag={part.tag} positive={part.positive} />
            ))}
          </div>
        </section>

        <section className="mb-8 animate-fade-up" style={{ animationDelay: "0.22s" }}>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">Evidence Sources</h3>
          <div className="space-y-3">
            {result.evidenceSources.length > 0 ? (
              result.evidenceSources.map((e, i) => (
                <EvidenceCard key={i} title={e.title} domain={getDomainFromUrl(e.url)} snippet={e.snippet} url={e.url} />
              ))
            ) : (
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                No evidence links were returned for this input.
              </div>
            )}
          </div>
        </section>

        <section className="mb-8 animate-fade-up" style={{ animationDelay: "0.25s" }}>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">Recommended Next Steps</h3>
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            {(result.recommendedActions.length > 0 ? result.recommendedActions : ["Re-check with additional trusted sources before acting."]).map((nextStep, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-foreground/90 leading-relaxed">{nextStep}</p>
              </div>
            ))}
          </div>
        </section>

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
                [
                  `Zeda ${mode === "verify" ? "Verification" : "Protection"} Report`,
                  `Verdict: ${verdict}`,
                  `Veracity Index: ${score}/100`,
                  "",
                  "Potentially Fake Parts:",
                  ...(result.fakeParts.length ? result.fakeParts.map((part) => `- ${part}`) : ["- None identified"]),
                  "",
                  "Evidence Sources:",
                  ...(result.evidenceSources.length ? result.evidenceSources.map((source) => `- ${source.title}: ${source.url}`) : ["- None"]),
                ].join("\n"),
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
