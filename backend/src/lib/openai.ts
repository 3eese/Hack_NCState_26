type OpenAIMessagePart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

type OpenAIMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string | OpenAIMessagePart[];
};

type OpenAIVisionOptions = {
    model?: string;
    maxTokens?: number;
    systemPrompt?: string;
    userPrompt?: string;
};

type ClaimExtractionOptions = {
    model?: string;
    maxTokens?: number;
    systemPrompt?: string;
};

type OpenAIChatCompletion = {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
};

export type ClaimExtractionResult = {
    claimSummary: string;
    keyEntities: string[];
    searchQueries: string[];
    extractionMethod: 'llm' | 'heuristic-fallback';
};

const DEFAULT_VISION_MODEL = 'gpt-4.1-mini';
const DEFAULT_VERIFY_MODEL = 'gpt-4.1-mini';
const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_VERIFY_MAX_TOKENS = 450;
const DEFAULT_VISION_SYSTEM_PROMPT = 'You are an OCR engine. Extract all visible text. Preserve line breaks.';
const DEFAULT_VISION_USER_PROMPT = 'Extract all text from this image.';
const DEFAULT_VERIFY_SYSTEM_PROMPT = [
    'You are a claim extraction assistant for misinformation verification.',
    'Return only JSON with keys: claimSummary, keyEntities, searchQueries.',
    'claimSummary: 1-2 concise factual sentences.',
    'keyEntities: array of important organizations, people, locations, dates.',
    'searchQueries: 2-4 short web-search queries for validation.'
].join(' ');
const DEFAULT_TIMEOUT_MS = 20000;

export class OpenAIRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

const resolveBaseUrl = (): string => {
    const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    return baseUrl.replace(/\/+$/, '');
};

const resolveApiKey = (): string => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new OpenAIRequestError(500, 'Missing OPENAI_API_KEY for OpenAI requests.');
    }
    return apiKey;
};

const resolveTimeoutMs = (): number => {
    const raw = Number(process.env.OPENAI_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw > 0) {
        return raw;
    }
    return DEFAULT_TIMEOUT_MS;
};

const requestChatCompletion = async (
    messages: OpenAIMessage[],
    model: string,
    maxTokens: number,
    temperature: number
): Promise<string> => {
    const apiKey = resolveApiKey();
    const baseUrl = resolveBaseUrl();
    const timeoutMs = resolveTimeoutMs();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                temperature,
                max_tokens: maxTokens,
                messages
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[OpenAI] Chat completion error:', response.status, errorText.slice(0, 500));
            const status = response.status >= 500 ? 502 : response.status;
            throw new OpenAIRequestError(status, 'OpenAI request failed.');
        }

        const payload = (await response.json()) as OpenAIChatCompletion;
        return payload.choices?.[0]?.message?.content?.trim() ?? '';
    } catch (error) {
        if (error instanceof OpenAIRequestError) {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new OpenAIRequestError(504, 'OpenAI request timed out.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

const normalizeWhitespace = (value: string): string =>
    value
        .replace(/\r/g, '\n')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const toStringArray = (value: unknown, maxItems: number): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const results: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') {
            continue;
        }
        const normalized = normalizeWhitespace(item);
        if (!normalized) {
            continue;
        }
        results.push(normalized);
        if (results.length >= maxItems) {
            break;
        }
    }
    return results;
};

const extractPotentialJson = (raw: string): string | null => {
    if (!raw) {
        return null;
    }

    const fencedMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
        return fencedMatch[1].trim();
    }

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return raw.slice(firstBrace, lastBrace + 1);
    }

    return null;
};

const heuristicClaimSummary = (text: string): string => {
    const normalized = normalizeWhitespace(text);
    if (!normalized) {
        return '';
    }

    const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [];
    const picked: string[] = [];

    for (const sentence of sentences) {
        const trimmed = normalizeWhitespace(sentence);
        if (!trimmed) {
            continue;
        }
        picked.push(trimmed);
        if (picked.length >= 2) {
            break;
        }
    }

    const joined = picked.join(' ');
    if (joined) {
        return joined.slice(0, 320);
    }
    return normalized.slice(0, 320);
};

const buildFallbackQueries = (claimSummary: string): string[] => {
    if (!claimSummary) {
        return [];
    }

    return [claimSummary, `${claimSummary} official source`].map((query) => normalizeWhitespace(query)).slice(0, 2);
};

export const extractTextFromImage = async (
    dataUrl: string,
    options: OpenAIVisionOptions = {}
): Promise<string> => {
    if (!dataUrl) {
        throw new OpenAIRequestError(400, 'Missing image data URL.');
    }

    const model = options.model ?? process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL;
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    const systemPrompt = options.systemPrompt ?? DEFAULT_VISION_SYSTEM_PROMPT;
    const userPrompt = options.userPrompt ?? DEFAULT_VISION_USER_PROMPT;

    return requestChatCompletion(
        [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: [
                    { type: 'text', text: userPrompt },
                    { type: 'image_url', image_url: { url: dataUrl } }
                ]
            }
        ],
        model,
        maxTokens,
        0
    );
};

export const extractClaimFromText = async (
    sourceText: string,
    options: ClaimExtractionOptions = {}
): Promise<ClaimExtractionResult> => {
    if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
        throw new OpenAIRequestError(400, 'Missing text content for claim extraction.');
    }

    const normalizedSource = normalizeWhitespace(sourceText).slice(0, 12000);
    const model = options.model ?? process.env.OPENAI_VERIFY_MODEL ?? DEFAULT_VERIFY_MODEL;
    const maxTokens = options.maxTokens ?? DEFAULT_VERIFY_MAX_TOKENS;
    const systemPrompt = options.systemPrompt ?? DEFAULT_VERIFY_SYSTEM_PROMPT;

    const llmResponse = await requestChatCompletion(
        [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: `Source text:\n${normalizedSource}`
            }
        ],
        model,
        maxTokens,
        0
    );

    const jsonCandidate = extractPotentialJson(llmResponse);
    if (!jsonCandidate) {
        const fallbackClaim = heuristicClaimSummary(normalizedSource);
        return {
            claimSummary: fallbackClaim,
            keyEntities: [],
            searchQueries: buildFallbackQueries(fallbackClaim),
            extractionMethod: 'heuristic-fallback'
        };
    }

    try {
        const parsed = JSON.parse(jsonCandidate) as {
            claimSummary?: unknown;
            keyEntities?: unknown;
            searchQueries?: unknown;
        };

        const claimSummary =
            typeof parsed.claimSummary === 'string'
                ? normalizeWhitespace(parsed.claimSummary).slice(0, 320)
                : heuristicClaimSummary(normalizedSource);

        const keyEntities = toStringArray(parsed.keyEntities, 12);
        const rawQueries = toStringArray(parsed.searchQueries, 4);
        const searchQueries = rawQueries.length > 0 ? rawQueries : buildFallbackQueries(claimSummary);

        return {
            claimSummary,
            keyEntities,
            searchQueries,
            extractionMethod: 'llm'
        };
    } catch {
        const fallbackClaim = heuristicClaimSummary(normalizedSource);
        return {
            claimSummary: fallbackClaim,
            keyEntities: [],
            searchQueries: buildFallbackQueries(fallbackClaim),
            extractionMethod: 'heuristic-fallback'
        };
    }
};
