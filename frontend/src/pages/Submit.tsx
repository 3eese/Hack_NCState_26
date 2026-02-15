import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Chip } from "@/components/Chip";
import { ArrowLeft, Eye, Image, Link, Lock, Search, Type, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import noirHero from "@/assets/noir-hero.jpg";

type InputType = "image" | "url" | "text";

const tabs: { id: InputType; label: string; icon: typeof Image }[] = [
  { id: "image", label: "Image", icon: Upload },
  { id: "url", label: "URL", icon: Link },
  { id: "text", label: "Text", icon: Type },
];

const Submit = () => {
  const [searchParams] = useSearchParams();
  const mode = (searchParams.get("mode") as "verify" | "protect") || "verify";
  const isVerify = mode === "verify";
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<InputType>("text");
  const [textInput, setTextInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  const canSubmit =
    (activeTab === "text" && textInput.trim().length > 10) ||
    (activeTab === "url" && urlInput.trim().length > 5) ||
    (activeTab === "image" && imageFile !== null);

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleAnalyze = () => {
    const content =
      activeTab === "text"
        ? textInput.trim()
        : activeTab === "url"
          ? urlInput.trim()
          : imagePreview ?? "";

    const submission = {
      mode,
      inputType: activeTab,
      content,
      createdAt: Date.now(),
    };

    sessionStorage.setItem("zeda:lastSubmission", JSON.stringify(submission));
    navigate(`/results?mode=${mode}`);
  };

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
            <ArrowLeft className="w-4 h-4" />
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-sharp bg-brass text-noir-base">
                {isVerify ? <Eye className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </div>
              <span className="font-display text-xl text-foreground">Zeda</span>
            </div>
          </button>
          <Chip variant={isVerify ? "success" : "warning"}>
            {isVerify ? "Verification Mode" : "Protection Mode"}
          </Chip>
        </div>
      </nav>

      <main className="relative z-10 flex min-h-[calc(100vh-72px)] items-center px-6 py-10">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-10 animate-fade-in-up">
            <div className={cn("mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]", isVerify ? "text-brass" : "text-emerald-safe")}>
              {isVerify ? <Eye className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {isVerify ? "Verify Mode" : "Protect Mode"}
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {isVerify ? "What needs verifying?" : "What needs protection?"}
            </h1>
            <p className="mt-3 text-lg text-muted-foreground">
              {isVerify
                ? "Submit text, URLs, or screenshots to check authenticity against public signals."
                : "Scan suspicious content for phishing, PII exposure, and tracker risk."}
            </p>
          </div>

          <div className="animate-fade-in-up overflow-hidden rounded-sharp border border-white/10 bg-noir-card" style={{ animationDelay: "120ms" }}>
            <div className="grid grid-cols-3 border-b border-white/10">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center justify-center gap-1 border-b-2 px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] transition-all duration-300 sm:gap-2 sm:px-5 sm:text-xs sm:tracking-[0.18em]",
                    activeTab === tab.id
                      ? "border-brass text-brass"
                      : "border-transparent text-muted-foreground hover:border-white/20 hover:text-foreground"
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-6 md:p-8">
              {activeTab === "text" && (
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={isVerify ? "Paste the claim, post, or alert to verify..." : "Paste suspicious text to scan for risks..."}
                  className="input-noir h-48 w-full resize-none text-base"
                />
              )}

              {activeTab === "url" && (
                <div className="relative">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://example.com/article..."
                    className="input-noir w-full text-base"
                  />
                </div>
              )}

              {activeTab === "image" && (
                <div className="space-y-4">
                  {!imagePreview ? (
                    <label
                      className="group flex h-52 w-full cursor-pointer flex-col items-center justify-center rounded-sharp border-2 border-dashed border-white/15 transition-colors hover:border-brass/45"
                    >
                      <Upload className="mb-3 h-10 w-10 text-muted-foreground transition-colors group-hover:text-brass" />
                      <span className="text-sm text-muted-foreground">Drop an image or click to upload</span>
                      <span className="mt-1 text-xs text-muted-foreground/70">PNG, JPG up to 10MB</span>
                      <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                    </label>
                  ) : (
                    <div className="relative">
                      <img src={imagePreview} alt="Preview" className="h-52 w-full rounded-sharp bg-noir-surface object-contain" />
                      <button
                        onClick={clearImage}
                        className="absolute right-2 top-2 rounded-full border border-white/20 bg-noir-base/90 p-2 text-foreground transition-colors hover:border-destructive hover:text-destructive"
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <p className="mt-2 truncate text-sm text-muted-foreground">{imageFile?.name}</p>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleAnalyze}
                disabled={!canSubmit}
                className={cn(
                  "mt-6 flex w-full items-center justify-center gap-3 rounded-sharp px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40",
                  isVerify
                    ? "bg-brass text-noir-base hover:bg-brass-accent hover:shadow-glow"
                    : "bg-emerald-safe text-noir-base hover:bg-emerald-500 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                )}
              >
                <Search className="h-5 w-5" />
                {isVerify ? "Start Verification" : "Scan for Threats"}
              </button>
            </div>
          </div>

          <p className="mt-6 animate-fade-in text-center text-sm text-muted-foreground" style={{ animationDelay: "220ms" }}>
            <span className="text-brass">Tip:</span> include source context and full links for sharper results.
          </p>
        </div>
      </main>
    </div>
  );
};

export default Submit;
