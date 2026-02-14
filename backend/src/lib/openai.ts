type OpenAIVisionOptions = {
    model?: string;
    maxTokens?: number;
    systemPrompt?: string;
    userPrompt?: string;
};

type OpenAIChatCompletion = {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
};

const DEFAULT_VISION_MODEL = 'gpt-4.1-mini';
const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_SYSTEM_PROMPT = 'You are an OCR engine. Extract all visible text. Preserve line breaks.';
const DEFAULT_USER_PROMPT = 'Extract all text from this image.';
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
        throw new OpenAIRequestError(500, 'Missing OPENAI_API_KEY for image OCR.');
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

export const extractTextFromImage = async (
    dataUrl: string,
    options: OpenAIVisionOptions = {}
): Promise<string> => {
    if (!dataUrl) {
        throw new OpenAIRequestError(400, 'Missing image data URL.');
    }

    const apiKey = resolveApiKey();
    const baseUrl = resolveBaseUrl();
    const model = options.model ?? process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL;
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const userPrompt = options.userPrompt ?? DEFAULT_USER_PROMPT;
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
                temperature: 0,
                max_tokens: maxTokens,
                messages: [
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
                ]
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[OpenAI] Vision error:', response.status, errorText.slice(0, 500));
            const status = response.status >= 500 ? 502 : response.status;
            throw new OpenAIRequestError(status, 'Vision OCR request failed.');
        }

        const payload = (await response.json()) as OpenAIChatCompletion;
        const text = payload.choices?.[0]?.message?.content?.trim();
        return text ?? '';
    } catch (error) {
        if (error instanceof OpenAIRequestError) {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new OpenAIRequestError(504, 'Vision OCR request timed out.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};
