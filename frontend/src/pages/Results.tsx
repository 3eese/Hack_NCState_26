import { useSearchParams, useNavigate } from "react-router-dom";
import { ScoreGauge, getVerdict } from "@/components/ScoreGauge";
import { EvidenceCard } from "@/components/EvidenceCard";
import { ReasonBullet } from "@/components/ReasonBullet";
import { Chip } from "@/components/Chip";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { ArrowLeft, Copy, Eye, Lock, RotateCcw, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import noirHero from "@/assets/noir-hero.jpg";

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

type StepTimingKey = "extractingContent" | "analyzingClaimsOrRisk" | "scoringAndReport";

type EndpointResult<T = unknown> = {
  ok: boolean;
  status: number;
  ms: number;
  data: T | null;
  error: string | null;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const DEFAULT_REQUEST_TIMEOUT_MS = 70000;
const INGEST_REQUEST_TIMEOUT_MS = 25000;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readTrimmedString = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const formatDurationLabel = (durationMs: number): string => {
  const seconds = Math.max(0, durationMs / 1000);
  if (seconds >= 10) {
    return `${Math.round(seconds)}s`;
  }
  return `${seconds.toFixed(1)}s`;
};

const callJsonEndpoint = async <T,>(
  url: string,
  payload: Record<string, unknown>,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<EndpointResult<T>> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    const envelope = isRecord(json) ? json : null;
    const isApiSuccess = envelope ? envelope.status !== "error" : true;
    const ok = response.ok && isApiSuccess;
    const endpointMessage = envelope && typeof envelope.message === "string" && envelope.message.trim().length > 0
      ? envelope.message.trim()
      : `Request failed with status ${response.status}.`;

    return {
      ok,
      status: response.status,
      ms: performance.now() - startedAt,
      data: envelope ? (envelope.data as T | null) : null,
      error: ok ? null : endpointMessage,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `Request timed out after ${Math.round(timeoutMs / 1000)}s.`
      : error instanceof Error
        ? error.message
        : "Unknown request failure.";

    return {
      ok: false,
      status: 0,
      ms: performance.now() - startedAt,
      data: null,
      error: message,
    };
  } finally {
    window.clearTimeout(timeout);
  }
};

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
  const [stepTimingsMs, setStepTimingsMs] = useState<Partial<Record<StepTimingKey, number>>>({});
  const [activeStepTiming, setActiveStepTiming] = useState<{ key: StepTimingKey; startedAt: number } | null>(null);
  const [activeStepElapsedMs, setActiveStepElapsedMs] = useState(0);

  useEffect(() => {
    if (!activeStepTiming) {
      setActiveStepElapsedMs(0);
      return;
    }

    const updateElapsed = () => {
      setActiveStepElapsedMs(Math.max(0, performance.now() - activeStepTiming.startedAt));
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeStepTiming]);

  useEffect(() => {
    let mounted = true;

    // Measure each visible phase directly so the UI shows real elapsed time, not a synthetic timer.
    const runMeasuredStep = async <T,>(
      key: StepTimingKey,
      activeStepIndex: number,
      task: () => Promise<T>,
    ): Promise<T> => {
      if (mounted) {
        setStep(activeStepIndex);
      }

      const startedAt = performance.now();
      if (mounted) {
        setActiveStepTiming({ key, startedAt });
      }

      try {
        return await task();
      } finally {
        const elapsedMs = performance.now() - startedAt;
        if (mounted) {
          setStepTimingsMs((current) => ({ ...current, [key]: elapsedMs }));
          setActiveStepTiming((current) => (current?.key === key ? null : current));
        }
      }
    };

    const fetchResult = async () => {
      try {
        const rawSubmission = sessionStorage.getItem("zeda:lastSubmission");
        if (!rawSubmission) {
          throw new Error("No submission found. Please submit an input first.");
        }

        const submission = JSON.parse(rawSubmission) as SubmissionPayload;
        const sourceContent = submission.content?.trim();
        if (!sourceContent) {
          throw new Error("Submission content is empty. Please try again.");
        }

        const endpoint = submission.mode === "protect" ? "protect" : "verify";
        let normalizedInputType: InputType = submission.inputType;
        let normalizedContent = sourceContent;
        let normalizedPayload: Record<string, unknown> | null = null;
        let ingestError: string | null = null;

        await runMeasuredStep("extractingContent", 0, async () => {
          const ingestResponse = await callJsonEndpoint<Record<string, unknown>>(
            `${API_BASE_URL}/api/ingest`,
            {
              inputType: submission.inputType,
              content: sourceContent,
            },
            INGEST_REQUEST_TIMEOUT_MS,
          );

          if (!ingestResponse.ok) {
            ingestError = ingestResponse.error;
            return;
          }

          const ingestData = ingestResponse.data;
          const candidatePayload = ingestData && isRecord(ingestData.normalizedPayload)
            ? ingestData.normalizedPayload
            : null;

          if (!candidatePayload) {
            return;
          }

          normalizedPayload = candidatePayload;

          const normalizedTypeRaw = readTrimmedString(candidatePayload.inputType);
          if (normalizedTypeRaw === "text" || normalizedTypeRaw === "url" || normalizedTypeRaw === "image") {
            normalizedInputType = normalizedTypeRaw;
          }

          const extractedText = readTrimmedString(candidatePayload.text);
          if (extractedText) {
            normalizedContent = extractedText;
          }
        });

        const analysisRequestBody: Record<string, unknown> = {
          inputType: normalizedInputType,
          content: normalizedContent || sourceContent,
        };

        if (normalizedPayload) {
          analysisRequestBody.normalizedPayload = normalizedPayload;
        }

        if (submission.inputType === "url") {
          analysisRequestBody.url = sourceContent;
        }

        let rawAnalysisData: unknown = null;
        await runMeasuredStep("analyzingClaimsOrRisk", 1, async () => {
          const analysisResponse = await callJsonEndpoint<unknown>(
            `${API_BASE_URL}/api/${endpoint}`,
            analysisRequestBody,
          );

          if (!analysisResponse.ok) {
            const fallbackHint = ingestError ? ` Ingest fallback: ${ingestError}` : "";
            throw new Error(`${analysisResponse.error || "Analysis failed."}${fallbackHint}`);
          }

          rawAnalysisData = analysisResponse.data;
        });

        await runMeasuredStep("scoringAndReport", 2, async () => {
          if (rawAnalysisData === null || rawAnalysisData === undefined) {
            throw new Error("Analysis returned an empty payload.");
          }

          if (mounted) {
            setResult(normalizeResultData(rawAnalysisData, submission.mode));
          }
        });
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : "Failed to run analysis.";
          setError(message);
        }
      } finally {
        if (mounted) {
          setActiveStepTiming(null);
          setStep(3);
          setLoading(false);
        }
      }
    };

    fetchResult();

    return () => {
      mounted = false;
    };
  }, []);

  const resolveTimingLabel = (key: StepTimingKey): string | undefined => {
    const measuredMs = stepTimingsMs[key];
    if (typeof measuredMs === "number") {
      return formatDurationLabel(measuredMs);
    }

    if (activeStepTiming?.key === key) {
      return formatDurationLabel(activeStepElapsedMs);
    }

    return undefined;
  };

  const analysisSteps = [
    {
      label: "Extracting content...",
      durationLabel: resolveTimingLabel("extractingContent"),
      status: step >= 1 ? "done" as const : step === 0 ? "active" as const : "pending" as const,
    },
    {
      label: mode === "verify" ? "Verifying claims..." : "Scanning privacy/scam risk...",
      durationLabel: resolveTimingLabel("analyzingClaimsOrRisk"),
      status: step >= 2 ? "done" as const : step === 1 ? "active" as const : "pending" as const,
    },
    {
      label: "Scoring & generating report...",
      durationLabel: resolveTimingLabel("scoringAndReport"),
      status: step >= 3 ? "done" as const : step === 2 ? "active" as const : "pending" as const,
    },
  ];

  if (loading) {
    return (
      <div className="relative min-h-screen overflow-x-hidden bg-noir-base">
        <div className="absolute inset-0 z-0">
          <img src={noirHero} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-noir-base/40" />
          <div className="absolute inset-0 noir-overlay" />
          <div className="absolute inset-0 vignette-overlay" />
          <div className="absolute inset-0 bg-gradient-to-br from-noir-surface/55 via-transparent to-transparent" />
        </div>
        <div className="noise-overlay" aria-hidden="true" />
        <nav className="relative z-10 glass-dark">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-6 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-sharp bg-brass text-noir-base">
              {mode === "verify" ? <Eye className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </div>
            <span className="font-display text-xl text-foreground">Zeda</span>
          </div>
        </nav>
        <main className="relative z-10 flex min-h-[calc(100vh-72px)] items-center justify-center px-6">
          <div className="w-full max-w-sm rounded-sharp border border-white/10 bg-noir-card p-7">
            <h2 className="mb-6 font-display text-2xl text-foreground">Analyzing...</h2>
            <AnalysisProgress steps={analysisSteps} />
          </div>
        </main>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="relative min-h-screen overflow-x-hidden bg-noir-base">
        <div className="absolute inset-0 z-0">
          <img src={noirHero} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-noir-base/40" />
          <div className="absolute inset-0 noir-overlay" />
          <div className="absolute inset-0 vignette-overlay" />
          <div className="absolute inset-0 bg-gradient-to-br from-noir-surface/55 via-transparent to-transparent" />
        </div>
        <div className="noise-overlay" aria-hidden="true" />
        <nav className="relative z-10 glass-dark">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              <span className="font-display text-xl text-foreground">Zeda</span>
            </button>
          </div>
        </nav>
        <main className="relative z-10 mx-auto w-full max-w-3xl px-6 py-12">
          <div className="rounded-sharp border border-destructive/40 bg-noir-card p-6">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-destructive">Analysis Error</h3>
            <p className="text-sm leading-relaxed text-foreground/90">{error || "No analysis result available."}</p>
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
    <div className="relative min-h-screen overflow-x-hidden bg-noir-base">
      <div className="absolute inset-0 z-0">
        <img src={noirHero} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-noir-base/40" />
        <div className="absolute inset-0 noir-overlay" />
        <div className="absolute inset-0 vignette-overlay" />
        <div className="absolute inset-0 bg-gradient-to-br from-noir-surface/55 via-transparent to-transparent" />
      </div>
      <div className="noise-overlay" aria-hidden="true" />

      <nav className="relative z-10 glass-dark">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-sharp bg-brass text-noir-base">
                {mode === "verify" ? <Eye className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </div>
              <span className="font-display text-xl text-foreground">Zeda</span>
            </div>
          </button>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Chip variant={mode === "verify" ? "success" : "warning"}>{mode === "verify" ? "Verify" : "Protect"}</Chip>
          </div>
        </div>
      </nav>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-10 animate-fade-in-up">
          <div className={cn("mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]", mode === "verify" ? "text-brass" : "text-emerald-safe")}>
            {mode === "verify" ? <Eye className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {mode === "verify" ? "Verification Results" : "Protection Scan Results"}
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Analysis Complete</h1>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="space-y-8">
            <section className="animate-fade-in-up rounded-sharp border border-white/10 bg-noir-card p-7" style={{ animationDelay: "60ms" }}>
              <div className="flex flex-col items-center gap-7 md:flex-row">
                <ScoreGauge score={score} label="Veracity Index" />
                <div className="text-center md:text-left">
                  <Chip
                    variant={score >= 75 && mode === "verify" ? "success" : score < 40 && mode === "verify" ? "danger" : mode === "protect" && score >= 65 ? "danger" : "warning"}
                    className="mb-3"
                  >
                    {verdict}
                  </Chip>
                  <p className="max-w-xl text-base leading-relaxed text-foreground/90">
                    {result.summary || "No summary returned by the model."}
                  </p>
                </div>
              </div>
            </section>

            <section className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-foreground">Key Findings</h3>
              <div className="rounded-sharp border border-white/10 bg-noir-card p-4 divide-y divide-border">
                {(result.keyFindings.length > 0 ? result.keyFindings : ["No key findings returned."]).map((finding, i) => (
                  <ReasonBullet key={i} text={finding} tag="Source" positive={mode === "verify"} />
                ))}
              </div>
            </section>

            <section className="animate-fade-in-up" style={{ animationDelay: "140ms" }}>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-foreground">Potentially Suspicious Segments</h3>
              <div className="rounded-sharp border border-white/10 bg-noir-card p-4 divide-y divide-border">
                {(fakePartReasons.length > 0
                  ? fakePartReasons
                  : [{ text: "No suspicious sections were explicitly flagged.", tag: "Consistency" as const, positive: true }]
                ).map((part, i) => (
                  <ReasonBullet key={i} text={part.text} tag={part.tag} positive={part.positive} />
                ))}
              </div>
            </section>

            <section className="animate-fade-in-up" style={{ animationDelay: "180ms" }}>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-foreground">Evidence Sources</h3>
              <div className="space-y-3">
                {result.evidenceSources.length > 0 ? (
                  result.evidenceSources.map((e, i) => (
                    <EvidenceCard key={i} title={e.title} domain={getDomainFromUrl(e.url)} snippet={e.snippet} url={e.url} />
                  ))
                ) : (
                  <div className="rounded-sharp border border-white/10 bg-noir-card p-4 text-sm text-muted-foreground">
                    No evidence links were returned for this input.
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="animate-slide-in-right space-y-5 lg:sticky lg:top-24 lg:h-fit" style={{ animationDelay: "220ms" }}>
            <section className="rounded-sharp border border-white/10 bg-noir-card p-5">
              <h3 className="mb-4 font-display text-2xl text-foreground">Recommended Actions</h3>
              <div className="space-y-3">
                {(result.recommendedActions.length > 0 ? result.recommendedActions : ["Re-check with additional trusted sources before acting."]).map((nextStep, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <p className="text-sm leading-relaxed text-foreground/90">{nextStep}</p>
                  </div>
                ))}
              </div>
            </section>

            <button
              onClick={() => navigate("/")}
              className="flex w-full items-center justify-center gap-2 rounded-sharp border border-white/15 bg-noir-card px-5 py-4 text-sm font-semibold uppercase tracking-[0.14em] text-foreground transition-all duration-300 hover:border-brass/55 hover:text-brass"
            >
              <RotateCcw className="h-4 w-4" />
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
              className="flex w-full items-center justify-center gap-2 rounded-sharp bg-brass px-5 py-4 text-sm font-semibold uppercase tracking-[0.14em] text-noir-base transition-all duration-300 hover:bg-brass-accent hover:shadow-glow"
            >
              <Copy className="h-4 w-4" />
              Copy Receipt
            </button>

            <button
              onClick={() => navigate(`/submit?mode=${mode}`)}
              className="flex w-full items-center justify-center gap-2 rounded-sharp border border-white/15 px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-all duration-300 hover:border-white/30 hover:text-foreground"
            >
              <Search className="h-4 w-4" />
              New Investigation
            </button>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default Results;
