type AnalysisMode = 'verify' | 'protect';
type InputType = 'text' | 'url' | 'image';

type AnalyzeInputParams = {
    mode: AnalysisMode;
    inputType: InputType;
    content: string;
};

type EvidenceSource = {
    title: string;
    url: string;
    snippet: string;
};

export type GeminiAnalysisResult = {
    mode: AnalysisMode;
    inputType: InputType;
    veracityIndex: number;
    verdict: string;
    summary: string;
    extractedText: string;
    keyFindings: string[];
    fakeParts: string[];
    recommendedActions: string[];
    evidenceSources: EvidenceSource[];
    model: string;
};

type GeminiCandidate = {
    content?: {
        parts?: Array<{
            text?: string;
        }>;
    };
    groundingMetadata?: {
        webSearchQueries?: string[];
        groundingChunks?: Array<{
            web?: {
                uri?: string;
                title?: string;
            };
        }>;
        groundingSupports?: Array<{
            segment?: {
                text?: string;
            };
            groundingChunkIndices?: number[];
        }>;
    };
};

type GeminiGenerateContentResponse = {
    candidates?: GeminiCandidate[];
};

type GeminiRawResponse = Partial<Omit<GeminiAnalysisResult, 'mode' | 'inputType' | 'model'>> & {
    evidenceSources?: Array<Partial<EvidenceSource>>;
};

const DEFAULT_MODEL = 'gemini-1.5-flash';
const DEFAULT_TIMEOUT_MS = 25000;
const DATA_URL_REGEX = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;

export class GeminiRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

const resolveApiKey = (): string => {
    const raw = process.env.GEMINI_API_KEY;
    const key = (raw ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (!key) {
        throw new GeminiRequestError(500, 'Missing GEMINI_API_KEY for analysis.');
    }
    return key;
};

const resolveModel = (): string => process.env.GEMINI_MODEL || DEFAULT_MODEL;

const resolveTimeoutMs = (): number => {
    const raw = Number(process.env.GEMINI_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw > 0) {
        return raw;
    }
    return DEFAULT_TIMEOUT_MS;
};

const sanitizeScore = (value: unknown): number => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(numeric)));
};

const sanitizeStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
        .slice(0, 12);
};

const sanitizeEvidence = (value: unknown): EvidenceSource[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => {
            const candidate = item as Partial<EvidenceSource>;
            const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
            const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
            const snippet = typeof candidate.snippet === 'string' ? candidate.snippet.trim() : '';

            if (!title || !url || !snippet) {
                return null;
            }
            return { title, url, snippet };
        })
        .filter((item): item is EvidenceSource => item !== null)
        .slice(0, 8);
};

const sanitizeGroundedEvidence = (
    groundingMetadata: GeminiCandidate['groundingMetadata'] | undefined
): EvidenceSource[] => {
    if (!groundingMetadata) {
        return [];
    }

    const chunks = groundingMetadata.groundingChunks ?? [];
    const supports = groundingMetadata.groundingSupports ?? [];
    const snippetByChunkIndex = new Map<number, string[]>();

    for (const support of supports) {
        const snippet = typeof support.segment?.text === 'string' ? support.segment.text.trim() : '';
        if (!snippet || !support.groundingChunkIndices?.length) {
            continue;
        }

        for (const index of support.groundingChunkIndices) {
            if (!Number.isInteger(index)) {
                continue;
            }
            const existing = snippetByChunkIndex.get(index) ?? [];
            if (!existing.includes(snippet)) {
                existing.push(snippet);
            }
            snippetByChunkIndex.set(index, existing);
        }
    }

    const grounded = chunks
        .map((chunk, index): EvidenceSource | null => {
            const url = typeof chunk.web?.uri === 'string' ? chunk.web.uri.trim() : '';
            if (!url) {
                return null;
            }

            const title = typeof chunk.web?.title === 'string' && chunk.web.title.trim().length > 0
                ? chunk.web.title.trim()
                : 'Grounded Web Source';

            const snippets = snippetByChunkIndex.get(index) ?? [];
            const snippet = snippets.join(' ').trim() || `Grounded source retrieved for this analysis.`;

            return { title, url, snippet };
        })
        .filter((item): item is EvidenceSource => item !== null);

    const deduped: EvidenceSource[] = [];
    for (const item of grounded) {
        if (!deduped.some((existing) => existing.url === item.url)) {
            deduped.push(item);
        }
        if (deduped.length >= 8) {
            break;
        }
    }
    return deduped;
};

const extractJsonString = (text: string): string => {
    const trimmed = text.trim();

    if (trimmed.startsWith('```')) {
        const withoutFences = trimmed
            .replace(/^```(?:json)?/i, '')
            .replace(/```$/i, '')
            .trim();
        if (withoutFences.startsWith('{') && withoutFences.endsWith('}')) {
            return withoutFences;
        }
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return trimmed.slice(start, end + 1);
    }

    return trimmed;
};

const parseDataUrl = (dataUrl: string): { mimeType: string; base64Data: string } => {
    const match = dataUrl.match(DATA_URL_REGEX);
    if (!match?.[1] || !match?.[2]) {
        throw new GeminiRequestError(400, 'Image content must be a valid base64 data URL.');
    }
    return {
        mimeType: match[1].toLowerCase(),
        base64Data: match[2].replace(/\s+/g, '')
    };
};

const buildPrompt = (mode: AnalysisMode): string => {
    return [
        `You are the ${mode === 'verify' ? 'Veracity Engine' : 'Identity Guard'} for a security platform.`,
        'Analyze user input and return strict JSON only.',
        'Required JSON fields:',
        '{',
        '  "veracityIndex": number, // 0-100',
        '  "verdict": string,',
        '  "summary": string,',
        '  "extractedText": string, // OCR text if image, else echo concise analyzed content',
        '  "keyFindings": string[], // concise bullet-style findings',
        '  "fakeParts": string[], // suspicious, false, contradictory, or manipulative segments',
        '  "recommendedActions": string[],',
        '  "evidenceSources": [',
        '    { "title": string, "url": string, "snippet": string }',
        '  ]',
        '}',
        'Rules:',
        '- Return only valid JSON. No markdown.',
        '- veracityIndex must be integer 0-100.',
        '- fakeParts must quote or paraphrase suspicious sections from the input.',
        '- evidenceSources must include reputable references with full https URLs when possible.',
        '- If evidence is unavailable, return an empty evidenceSources array.',
        mode === 'verify'
            ? '- Focus on truthfulness and factual consistency.'
            : '- Focus on scam markers, privacy risks, and identity theft signals.'
    ].join('\n');
};

const parseModelText = (payload: GeminiGenerateContentResponse): string => {
    const parts = payload.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
        return '';
    }

    return parts
        .map((part) => part.text ?? '')
        .join('\n')
        .trim();
};

const parseApiErrorMessage = (errorText: string): string => {
    let apiMessage = 'Gemini analysis request failed.';

    try {
        const parsed = JSON.parse(errorText) as {
            error?: {
                message?: string;
            };
        };
        if (parsed.error?.message) {
            apiMessage = parsed.error.message;
        }
    } catch {
        if (errorText.trim().length > 0) {
            apiMessage = errorText.trim();
        }
    }

    return apiMessage;
};

const normalizeResult = (
    raw: GeminiRawResponse,
    payload: GeminiGenerateContentResponse,
    mode: AnalysisMode,
    inputType: InputType,
    model: string
): GeminiAnalysisResult => {
    const veracityIndex = sanitizeScore(raw.veracityIndex);
    const fakeParts = sanitizeStringArray(raw.fakeParts);
    const keyFindings = sanitizeStringArray(raw.keyFindings);
    const recommendedActions = sanitizeStringArray(raw.recommendedActions);
    const groundedEvidence = sanitizeGroundedEvidence(payload.candidates?.[0]?.groundingMetadata);
    const modelEvidence = sanitizeEvidence(raw.evidenceSources);
    const evidenceSources = groundedEvidence.length > 0 ? groundedEvidence : modelEvidence;
    const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
    const verdict =
        typeof raw.verdict === 'string' && raw.verdict.trim().length > 0
            ? raw.verdict.trim()
            : mode === 'verify'
              ? veracityIndex >= 75
                  ? 'Likely Real'
                  : veracityIndex >= 40
                    ? 'Unverified'
                    : 'Likely Fake'
              : veracityIndex >= 65
                ? 'High Risk'
                : veracityIndex >= 35
                  ? 'Medium Risk'
                  : 'Low Risk';
    const extractedText = typeof raw.extractedText === 'string' ? raw.extractedText.trim() : '';

    return {
        mode,
        inputType,
        veracityIndex,
        verdict,
        summary,
        extractedText,
        keyFindings,
        fakeParts,
        recommendedActions,
        evidenceSources,
        model
    };
};

export const analyzeInputWithGemini = async ({
    mode,
    inputType,
    content
}: AnalyzeInputParams): Promise<GeminiAnalysisResult> => {
    if (!content || !content.trim()) {
        throw new GeminiRequestError(400, 'Missing analysis content.');
    }

    const apiKey = resolveApiKey();
    const model = resolveModel();
    const timeoutMs = resolveTimeoutMs();
    const prompt = buildPrompt(mode);

    const parts: Array<Record<string, unknown>> = [{ text: prompt }];

    if (inputType === 'image') {
        const { mimeType, base64Data } = parseDataUrl(content.trim());
        parts.push({ text: 'Analyze this uploaded image for factual credibility and suspicious content.' });
        parts.push({
            inline_data: {
                mime_type: mimeType,
                data: base64Data
            }
        });
    } else {
        parts.push({
            text: `Input type: ${inputType}\nUser content:\n${content.trim()}`
        });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const requestWithTools = async (
        tools: Array<Record<string, unknown>>
    ): Promise<{ ok: true; payload: GeminiGenerateContentResponse } | { ok: false; status: number; message: string }> => {
        const response = await fetch(
            endpoint,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: 'user',
                            parts
                        }
                    ],
                    tools,
                    generationConfig: {
                        temperature: 0.1
                    }
                }),
                signal: controller.signal
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            const apiMessage = parseApiErrorMessage(errorText);
            return { ok: false, status: response.status, message: apiMessage };
        }

        const payload = (await response.json()) as GeminiGenerateContentResponse;
        return { ok: true, payload };
    };

    try {
        let requestResult = await requestWithTools([{ google_search: {} }]);

        if (!requestResult.ok && requestResult.status === 400) {
            const lowerMessage = requestResult.message.toLowerCase();
            if (lowerMessage.includes('google_search') || lowerMessage.includes('unknown name')) {
                requestResult = await requestWithTools([{ google_search_retrieval: {} }]);
            }
        }

        if (!requestResult.ok) {
            console.error('[Gemini] API error:', requestResult.status, requestResult.message.slice(0, 500));
            const status = requestResult.status >= 500 ? 502 : requestResult.status;
            throw new GeminiRequestError(status, requestResult.message);
        }

        const payload = requestResult.payload;
        const modelText = parseModelText(payload);
        if (!modelText) {
            throw new GeminiRequestError(502, 'Gemini returned an empty response.');
        }

        const jsonText = extractJsonString(modelText);
        let raw: GeminiRawResponse;
        try {
            raw = JSON.parse(jsonText) as GeminiRawResponse;
        } catch {
            throw new GeminiRequestError(502, 'Gemini returned malformed JSON.');
        }

        return normalizeResult(raw, payload, mode, inputType, model);
    } catch (error) {
        if (error instanceof GeminiRequestError) {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new GeminiRequestError(504, 'Gemini analysis request timed out.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};
