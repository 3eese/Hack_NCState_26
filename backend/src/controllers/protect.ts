import type { Request, Response } from 'express';
import { analyzeInputWithGemini, GeminiRequestError } from '../lib/gemini';

type ProtectRequestBody = {
    inputType?: unknown;
    content?: unknown;
    text?: unknown;
    url?: unknown;
    pageUrl?: unknown;
    normalizedPayload?: {
        text?: unknown;
        url?: {
            input?: unknown;
            final?: unknown;
        };
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

const readContentAndType = (
    body: ProtectRequestBody
): { content: string; inputType: 'text' | 'url' | 'image' } => {
    const explicitInputType = normalizeInputType(body.inputType);

    const candidates: Array<{ value: unknown; type: 'text' | 'url' | 'image' }> = [
        { value: body.content, type: explicitInputType ?? 'text' },
        { value: body.text, type: 'text' },
        { value: body.url, type: 'url' },
        { value: body.pageUrl, type: 'url' },
        { value: body.normalizedPayload?.text, type: 'text' },
        { value: body.normalizedPayload?.url?.input, type: 'url' },
        { value: body.normalizedPayload?.url?.final, type: 'url' }
    ];

    for (const candidate of candidates) {
        if (typeof candidate.value !== 'string') {
            continue;
        }
        const trimmed = candidate.value.trim();
        if (!trimmed) {
            continue;
        }
        return {
            content: trimmed,
            inputType: explicitInputType ?? candidate.type
        };
    }

    return {
        content: '',
        inputType: explicitInputType ?? 'text'
    };
};

export const handleProtect = async (req: Request, res: Response): Promise<void> => {
    try {
        const body = (req.body ?? {}) as ProtectRequestBody;
        const { content, inputType } = readContentAndType(body);

        if (!content) {
            res.status(400).json({ status: 'error', message: 'Provide text, URL, or image content for protection checks.' });
            return;
        }

        const data = await analyzeInputWithGemini({
            mode: 'protect',
            inputType,
            content
        });

        res.status(200).json({ status: 'success', data });
    } catch (error) {
        if (error instanceof GeminiRequestError) {
            res.status(error.status).json({ status: 'error', message: error.message });
            return;
        }

        console.error('[Protect Error]:', error);
        res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
};
