import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Chip } from "@/components/Chip";
import { Upload, Link, Type, ArrowLeft, Image } from "lucide-react";
import { cn } from "@/lib/utils";

type InputType = "image" | "url" | "text";

const tabs: { id: InputType; label: string; icon: typeof Image }[] = [
  { id: "image", label: "Image", icon: Upload },
  { id: "url", label: "URL", icon: Link },
  { id: "text", label: "Text", icon: Type },
];

const Submit = () => {
  const [searchParams] = useSearchParams();
  const mode = (searchParams.get("mode") as "verify" | "protect") || "verify";
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
          <Chip variant={mode === "verify" ? "success" : "warning"}>
            {mode === "verify" ? "Verify Mode" : "Protect Mode"}
          </Chip>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-lg w-full">
          <h2 className="text-2xl font-bold font-display text-foreground mb-1">
            {mode === "verify" ? "What do you want to verify?" : "Check for risks"}
          </h2>
          <p className="text-sm text-muted-foreground mb-8">
            {mode === "verify"
              ? "Paste a claim, link, or upload a screenshot to check against public sources."
              : "Paste a suspicious message or upload a screenshot to detect PII and scam signals."}
          </p>

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg mb-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-all",
                  activeTab === tab.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Input area */}
          <div className="mb-6">
            {activeTab === "text" && (
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Paste the claim, message, or announcement here..."
                className="w-full h-40 rounded-xl border border-border bg-card p-4 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
              />
            )}

            {activeTab === "url" && (
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/article..."
                className="w-full rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
              />
            )}

            {activeTab === "image" && (
              <label className={cn(
                "flex flex-col items-center justify-center w-full h-48 rounded-xl border-2 border-dashed transition-all cursor-pointer",
                imagePreview
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-card hover:border-primary/20"
              )}>
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" className="max-h-40 rounded-lg object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Upload className="w-8 h-8" />
                    <span className="text-sm font-medium">Drop a screenshot or click to upload</span>
                    <span className="text-xs">PNG, JPG up to 10MB</span>
                  </div>
                )}
                <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              </label>
            )}
          </div>

          <button
            onClick={handleAnalyze}
            disabled={!canSubmit}
            className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:glow-primary-strong active:scale-[0.98]"
          >
            Analyze
          </button>
        </div>
      </main>
    </div>
  );
};

export default Submit;
