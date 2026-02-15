import type { Request, Response } from 'express';
import { analyzeInputWithGemini, GeminiRequestError } from '../lib/gemini';

type VerifyRequestBody = {
    inputType?: unknown;
    content?: unknown;
    text?: unknown;
    normalizedPayload?: {
        text?: unknown;
    };
};

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

export const handleVerify = async (req: Request, res: Response): Promise<void> => {
    try {
        const body = (req.body ?? {}) as VerifyRequestBody;
        const inputType = normalizeInputType(body.inputType) ?? 'text';
        const content = readContent(body);

        if (!content) {
            res.status(400).json({ status: 'error', message: 'content is required.' });
            return;
        }

        const data = await analyzeInputWithGemini({
            mode: 'verify',
            inputType,
            content
        });

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