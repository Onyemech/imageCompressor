import express = require('express');
import optimizeHandler from './client/api/optimize';
import monitorHandler from './client/api/monitor';
import multer = require('multer');
import { optimizeImage } from './client/lib/optimizer';
import { s3, BUCKET, PUBLIC_URL } from './client/lib/s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import * as crypto from 'crypto';

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

// Wrapper to adapt Vercel handler to Express
const vercelToExpress = (handler: any) => async (req: express.Request, res: express.Response) => {
    // Vercel types are compatible with Express types for the most part
    // but we need to cast or ensure compatibility if strict typing is needed.
    await handler(req, res);
};

app.get('/health', (req, res) => {
    res.send('OK');
});

app.get('/', (req, res) => {
    res.send('Image Compression Service is Running');
});

// Map routes
app.get('/monitor', vercelToExpress(monitorHandler));
app.get('/api/optimize', vercelToExpress(optimizeHandler));

// New: Upload Endpoint
app.get('/api/upload', (req, res) => {
    res.status(405).send('Method Not Allowed. Please use POST to upload images.');
});

app.post('/api/upload', upload.single('image'), async (req: any, res: any) => {
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }

        const client = req.body.client || 'default';
        const width = req.body.w ? parseInt(req.body.w) : undefined;
        const quality = req.body.q ? parseInt(req.body.q) : 80;
        const format = req.body.f || 'webp';

        // Optimize
        const { data, info } = await optimizeImage(req.file.buffer, {
            width,
            quality,
            format: format as any
        });

        // Generate Key
        const hash = crypto.createHash('md5').update(data).digest('hex');
        const key = `${client}/${hash}.${format}`;

        // Upload to S3
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: data,
            ContentType: `image/${format}`
        }));

        const finalUrl = PUBLIC_URL ? `${PUBLIC_URL}/${key}` : `https://${BUCKET}.s3.${process.env.S3_REGION || 'auto'}.amazonaws.com/${key}`;

        res.json({
            url: finalUrl,
            size: info.size,
            format: info.format,
            width: info.width,
            height: info.height
        });

    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).send(`Error processing upload: ${(error as Error).message}`);
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
