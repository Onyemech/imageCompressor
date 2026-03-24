# Cloudflare Video Upload Worker

This repo now includes a Cloudflare Worker that accepts video uploads and stores them in an R2 bucket.

Deployed base URL (example): `https://cf-image-worker.sabimage.workers.dev`

## Endpoints

### POST /api/videos (multipart)

- Content-Type: `multipart/form-data`
- Field name: `file` (or `video`)
- Auth (optional): `Authorization: Bearer <VIDEO_UPLOAD_TOKEN>`

Response:

```json
{
  "ok": true,
  "key": "9b6e54c8-6a8e-4c0c-9d9c-3b8b2e0a6f90.mp4",
  "url": "https://<your-worker-domain>/api/videos/9b6e54c8-6a8e-4c0c-9d9c-3b8b2e0a6f90.mp4",
  "contentType": "video/mp4",
  "bytes": 12345
}
```

### PUT /api/videos/:key (raw upload)

- Sends the raw bytes as the request body (better for large files)
- Required headers:
  - `Content-Type: <video mime type>` (example: `video/mp4`)
- Optional headers:
  - `X-Filename: original-name.mp4`
  - `Authorization: Bearer <VIDEO_UPLOAD_TOKEN>`

Response:

```json
{
  "ok": true,
  "key": "my-key.mp4",
  "url": "https://<your-worker-domain>/api/videos/my-key.mp4",
  "contentType": "video/mp4"
}
```

### GET /api/videos/:key (stream)

- Streams the stored object from R2
- Supports HTTP `Range` requests (works well with HTML5 `<video>` playback)

### POST /upload (multipart, images/docs)

This is a compatibility route for typical “file upload worker” integrations (logos, documents, images).

- Content-Type: `multipart/form-data`
- Field name: `file` (also accepts `document`, `image`, `logo`)

Response:

```json
{
  "ok": true,
  "key": "files/<generated>",
  "url": "https://<your-worker-domain>/api/files/files%2F<generated>",
  "contentType": "application/pdf",
  "bytes": 12345
}
```

### POST /api/files (multipart, images/docs)

Same as `POST /upload`, but under a namespaced path.

### PUT /api/files/:key (raw upload) + GET /api/files/:key (stream)

- Use `PUT` for large docs/images
- `GET` supports `Range` (useful for streaming and resumable reads)

## Configuration

Worker code: [index.ts](file:///c:/Users/Chidi%20John%20Ochonma/Documents/saas/imageCompressor/workers/video-worker/src/index.ts)  
Wrangler config: [wrangler.toml](file:///c:/Users/Chidi%20John%20Ochonma/Documents/saas/imageCompressor/wrangler.toml)

### Required: R2 binding

Update `wrangler.toml` with your R2 bucket names:

- `bucket_name`
- `preview_bucket_name` (used by `wrangler dev`)

### Optional: auth token

If you set `VIDEO_UPLOAD_TOKEN`, uploads require:

`Authorization: Bearer <VIDEO_UPLOAD_TOKEN>`

### Optional: CORS

Set `ALLOWED_ORIGINS` as either:

- `*` (default)
- Comma-separated origins, e.g. `https://app.example.com,https://admin.example.com`

### Optional: max size

Set `MAX_VIDEO_BYTES` to a byte limit (default is 500MB).

## Deploy (Wrangler)

1) Install dependencies

```bash
npm i
```

2) Login

```bash
npx wrangler login
```

3) Create buckets (adjust names to match `wrangler.toml`)

```bash
npx wrangler r2 bucket create sabimage-videos
npx wrangler r2 bucket create sabimage-videos-dev
```

4) Set upload secret (optional but recommended)

```bash
npx wrangler secret put VIDEO_UPLOAD_TOKEN
```

5) Deploy

```bash
npm run cf:deploy
```

## Upload from the browser (client)

### Multipart (simple)

```ts
async function uploadVideo(file: File) {
  const fd = new FormData()
  fd.append("file", file)

  const res = await fetch("https://cf-image-worker.sabimage.workers.dev/api/videos", {
    method: "POST",
    body: fd,
    headers: {
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_VIDEO_UPLOAD_TOKEN ?? ""}`,
    },
  })

  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ ok: true; key: string; url: string }>
}
```

### Raw PUT (recommended for large videos)

```ts
async function uploadVideoPut(file: File) {
  const key = `${crypto.randomUUID()}.${(file.name.split(".").pop() || "mp4").toLowerCase()}`

  const res = await fetch(`https://cf-image-worker.sabimage.workers.dev/api/videos/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": file.name,
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_VIDEO_UPLOAD_TOKEN ?? ""}`,
    },
  })

  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ ok: true; key: string; url: string }>
}
```

## Upload from your server (Node.js)

### Raw PUT with a file stream

```ts
import { createReadStream } from "node:fs"

async function uploadVideoFromServer(filePath: string, key: string) {
  const stream = createReadStream(filePath)

  const res = await fetch(`https://cf-image-worker.sabimage.workers.dev/api/videos/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: stream as any,
    duplex: "half" as any,
    headers: {
      "Content-Type": "video/mp4",
      "X-Filename": key,
      Authorization: `Bearer ${process.env.VIDEO_UPLOAD_TOKEN ?? ""}`,
    },
  })

  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
```
