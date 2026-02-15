import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ModeCard } from "@/components/ModeCard";
import { Shield } from "lucide-react";
import noirHero from "@/assets/noir-hero.jpg";

const Index = () => {
  const [selectedMode, setSelectedMode] = useState<"verify" | "protect" | null>(null);
  const navigate = useNavigate();

  const handleContinue = () => {
    if (selectedMode) {
      navigate(`/submit?mode=${selectedMode}`);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-noir-base">
      <div className="absolute inset-0 z-0">
        <img src={noirHero} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-noir-base/30" />
        <div className="absolute inset-0 noir-overlay" />
        <div className="absolute inset-0 vignette-overlay" />
      </div>
      <div className="noise-overlay" aria-hidden="true" />

      <nav className="relative z-10 glass-dark">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <div className="group flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sharp bg-brass text-noir-base transition-all duration-300 group-hover:shadow-glow">
              <Shield className="h-5 w-5" />
            </div>
            <span className="font-display text-2xl font-semibold tracking-tight text-foreground">Zeda</span>
          </div>
          <span className="hidden text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground sm:block">
            Cognitive Firewall
          </span>
        </div>
      </nav>

      <main className="relative z-10 flex min-h-[calc(100vh-72px)] items-center px-6 py-16">
        <div className="mx-auto w-full max-w-7xl">
          <h1 className="max-w-4xl animate-fade-in-up font-display text-5xl font-semibold leading-[0.95] tracking-tight text-foreground sm:text-7xl">
            Read the signal.
            <br />
            <span className="text-brass">Before you trust</span> the noise.
          </h1>

          <p
            className="mt-6 max-w-2xl animate-fade-in-up text-lg leading-relaxed text-muted-foreground sm:text-xl"
            style={{ animationDelay: "120ms" }}
          >
            AI-powered verification and identity defense for screenshots, URLs, and raw text.
            Separate truth from manipulation before it spreads.
          </p>

          <div
            className="mt-12 grid max-w-5xl gap-6 md:grid-cols-2 lg:gap-8"
            style={{ animationDelay: "200ms" }}
          >
            <div className="animate-fade-in-up">
              <ModeCard mode="verify" selected={selectedMode === "verify"} onClick={() => setSelectedMode("verify")} />
            </div>
            <div className="animate-fade-in-up" style={{ animationDelay: "80ms" }}>
              <ModeCard mode="protect" selected={selectedMode === "protect"} onClick={() => setSelectedMode("protect")} />
            </div>
          </div>

          <div className="mt-8 flex max-w-2xl flex-col gap-4">
            <button
              onClick={handleContinue}
              disabled={!selectedMode}
              className="rounded-sharp bg-brass px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-noir-base transition-all duration-300 hover:bg-brass-accent hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-40"
            >
              Begin Investigation
            </button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Zeda provides probabilistic signals based on public evidence and heuristic analysis.
              It does not guarantee authenticity or full fraud prevention.
            </p>
          </div>

          <p className="mt-10 max-w-2xl text-editorial text-lg text-muted-foreground">
            We love projects that make you pause and think, “Why didn&apos;t I think of that?”
          </p>
        </div>
      </main>
    </div>
  );
};

export default Index;
