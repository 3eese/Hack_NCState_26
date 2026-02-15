import type { Request, Response } from 'express';
import { analyzeInputWithGemini, GeminiRequestError } from '../lib/gemini';

const normalizeInputType = (value: unknown): 'text' | 'url' | 'image' | null => {
    if (typeof value !== 'string') {
        return null;
    }

    if (value === 'text' || value === 'url' || value === 'image') {
        return value;
    }

    return null;
};

export const handleProtect = async (req: Request, res: Response): Promise<void> => {
    try {
        const inputType = normalizeInputType(req.body?.inputType);
        const content = typeof req.body?.content === 'string' ? req.body.content : '';

        if (!inputType) {
            res.status(400).json({ status: 'error', message: 'inputType must be one of text, url, image.' });
            return;
        }

        if (!content.trim()) {
            res.status(400).json({ status: 'error', message: 'content is required.' });
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
