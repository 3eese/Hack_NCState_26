import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Import your controllers (we will build these next)
import { handleIngest } from './controllers/ingest';
import { handleVerify } from './controllers/verify';
import { handleProtect } from './controllers/protect';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors()); // Crucial for allowing Next.js to talk to this API
app.use(express.json()); // Parses incoming JSON payloads

// Define Routes mapping to your System Design
app.post('/api/ingest', handleIngest);
app.post('/api/verify', handleVerify);
app.post('/api/protect', handleProtect);

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Zeda Backend is live on http://localhost:${PORT}`);
});