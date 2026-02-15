import type { Request, Response } from 'express';
import { analyzeInputWithGemini, GeminiRequestError, type GeminiAnalysisResult } from '../lib/gemini';

type VerifyRequestBody = {
    inputType?: unknown;
    content?: unknown;
    text?: unknown;
    normalizedPayload?: {
        text?: unknown;
    };
};

const DEFAULT_VERIFY_MODEL_TIMEOUT_MS = 12000;
const VERIFY_MODEL_TIMEOUT_MS = (() => {
    const raw = Number(process.env.VERIFY_MODEL_TIMEOUT_MS ?? process.env.GEMINI_VERIFY_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw > 0) {
        return raw;
    }
    return DEFAULT_VERIFY_MODEL_TIMEOUT_MS;
})();

const normalizeInputType = (value: unknown): 'text' | 'url' | 'image' | null => {
    if (typeof value !== 'string') {
        return null;
    }

    if (value === 'text' || value === 'url' || value === 'image') {
        return value;
    }

    return null;
};

const readContent = (body: VerifyRequestBody): string => {
    const candidates = [body.content, body.text, body.normalizedPayload?.text];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') {
            continue;
        }
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
            return trimmed;
        }
    }
    return '';
};

const buildVerifyFallback = (
    content: string,
    inputType: 'text' | 'url' | 'image',
    reason: string
): GeminiAnalysisResult => {
    const trimmed = content.trim();
    return {
        mode: 'verify',
        inputType,
        veracityIndex: 35,
        verdict: 'Unverified',
        summary: 'Live verification timed out. Returning fallback analysis without external evidence.',
        extractedText: trimmed.slice(0, 1200),
        keyFindings: [
            'The verification model timed out before completing evidence checks.',
            'No external evidence links were available in fallback mode.',
            `Timeout detail: ${reason}`
        ],
        fakeParts: [],
        recommendedActions: [
            'Retry verification in a moment when API latency is lower.',
            'Cross-check the claim against official sources before taking action.'
        ],
        evidenceSources: [],
        model: 'verify-fallback-v1'
    };
};

export const handleVerify = async (req: Request, res: Response): Promise<void> => {
    try {
        const body = (req.body ?? {}) as VerifyRequestBody;
        const inputType = normalizeInputType(body.inputType) ?? 'text';
        const content = readContent(body);

        if (!content) {
            res.status(400).json({ status: 'error', message: 'content is required.' });
            return;
        }

        let data: GeminiAnalysisResult;
        try {
            data = await analyzeInputWithGemini({
                mode: 'verify',
                inputType,
                content,
                timeoutMs: VERIFY_MODEL_TIMEOUT_MS
            });
        } catch (error) {
            if (error instanceof GeminiRequestError && error.status >= 500) {
                data = buildVerifyFallback(content, inputType, error.message);
            } else {
                throw error;
            }
        }

        res.status(200).json({ status: 'success', data });
    } catch (error) {
        if (error instanceof GeminiRequestError) {
            res.status(error.status).json({ status: 'error', message: error.message });
            return;
        }

        console.error('[Verify Error]:', error);
        res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
};
