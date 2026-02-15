import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ModeCard } from "@/components/ModeCard";
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
    <div className="min-h-screen flex flex-col relative">
      {/* Hero background */}
      <div className="absolute inset-0 z-0">
        <img src={noirHero} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 noir-overlay" />
        <div className="absolute inset-0 noir-vignette" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 border-b border-border/50 px-6 py-4 backdrop-blur-sm bg-background/30">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <img src="/zeda-logo.svg" alt="Zeda" className="w-4 h-4" />
            </div>
            <span className="text-lg font-bold text-foreground tracking-tight font-display">Zeda</span>
          </div>
          <span className="text-xs text-muted-foreground hidden sm:block font-light tracking-widest uppercase">
            Verify · Protect
          </span>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-xl w-full">
          <div className="text-center mb-10">
            <h1 className="text-4xl sm:text-5xl font-bold font-display text-foreground tracking-tight mb-3">
              Trust, <span className="text-gradient-primary italic">verified.</span>
            </h1>
            <p className="text-muted-foreground text-base max-w-md mx-auto leading-relaxed">
              Check misinformation and protect your identity from scams — using screenshots, URLs, or text.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <ModeCard mode="verify" selected={selectedMode === "verify"} onClick={() => setSelectedMode("verify")} />
            <ModeCard mode="protect" selected={selectedMode === "protect"} onClick={() => setSelectedMode("protect")} />
          </div>

          <button
            onClick={handleContinue}
            disabled={!selectedMode}
            className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:glow-primary-strong active:scale-[0.98]"
          >
            Continue
          </button>

          <p className="text-center text-[11px] text-muted-foreground mt-6 max-w-sm mx-auto leading-relaxed">
            Zeda provides probabilistic signals based on public evidence and heuristics. It cannot guarantee authenticity or prevent all fraud.
          </p>
        </div>
      </main>
    </div>
  );
};

export default Index;
