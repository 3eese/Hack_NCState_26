import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Import your controllers (we will build these next)
import { handleIngest } from './controllers/ingest';
import { handleVerify } from './controllers/verify';
import { handleProtect } from './controllers/protect';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 8000;
const DEFAULT_JSON_BODY_LIMIT = '20mb';
const JSON_BODY_LIMIT =
    (process.env.JSON_BODY_LIMIT || process.env.BODY_LIMIT || DEFAULT_JSON_BODY_LIMIT).trim();

type BodyParserError = Error & {
    status?: number;
    type?: string;
};

// Middleware
app.use(cors()); // Crucial for allowing Next.js to talk to this API
app.use(express.json({ limit: JSON_BODY_LIMIT })); // Accept larger payloads for base64 image submissions.
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

// Define Routes mapping to your System Design
app.post('/api/ingest', handleIngest);
app.post('/api/verify', handleVerify);
app.post('/api/protect', handleProtect);

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const parserError = error as BodyParserError;
    if (parserError?.status === 413 || parserError?.type === 'entity.too.large') {
        res.status(413).json({
            status: 'error',
            message: `Payload too large. Reduce upload size or increase JSON_BODY_LIMIT (current: ${JSON_BODY_LIMIT}).`
        });
        return;
    }

    next(error);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server Error]:', error);
    res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Zeda Backend is live on http://localhost:${PORT}`);
});
