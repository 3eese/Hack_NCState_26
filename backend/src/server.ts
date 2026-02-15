import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Import your controllers (we will build these next)
import { handleIngest } from './controllers/ingest';
import { handleVerify } from './controllers/verify';
import { handleProtect } from './controllers/protect';

dotenv.config();

const app: Application = express();
const PORT = Number(process.env.PORT) || 8000;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT ?? '2mb';
const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT ?? '2mb';

const OPTIONAL_ENV_VARS = ['OPENAI_API_KEY', 'SEARCH_API_KEY', 'SEARCH_ENGINE_ID'];
for (const key of OPTIONAL_ENV_VARS) {
    if (!process.env[key]) {
        console.warn(`[Config] Missing ${key} (feature may be limited).`);
    }
}

// Middleware
app.use(cors()); // Crucial for allowing Next.js to talk to this API
app.use(express.json({ limit: JSON_BODY_LIMIT })); // Parses incoming JSON payloads
app.use(express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }));

// Define Routes mapping to your System Design
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});
app.post('/api/ingest', handleIngest);
app.post('/api/verify', handleVerify);
app.post('/api/protect', handleProtect);

app.use((_req, res) => {
    res.status(404).json({ status: 'error', message: 'Route not found' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Unhandled Error]:', err);
    res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Zeda Backend is live on http://localhost:${PORT}`);
});
