import express = require('express');
import optimizeHandler from './client/api/optimize';
import monitorHandler from './client/api/monitor';

const app = express();
const port = process.env.PORT || 3000;

// Wrapper to adapt Vercel handler to Express
const vercelToExpress = (handler: any) => async (req: express.Request, res: express.Response) => {
    // Vercel types are compatible with Express types for the most part
    // but we need to cast or ensure compatibility if strict typing is needed.
    await handler(req, res);
};

app.get('/health', (req, res) => {
    res.send('OK');
});

// Map routes
app.get('/monitor', vercelToExpress(monitorHandler));
app.get('/api/optimize', vercelToExpress(optimizeHandler));

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
