# Image Optimization Service Integration Guide

This guide explains how to integrate the **Global Image Optimization Service** into your application. This service provides on-the-fly image optimization, caching (via S3/R2), and resizing.

## 1. Service Endpoint

You should configure the service URL in your environment variables.

```env
# .env
VITE_IMAGE_SERVICE_URL=https://your-image-service.vercel.app/api/optimize
```

*(Replace `https://your-image-service.vercel.app` with your actual Vercel deployment URL)*

## 2. Usage

### A. Constructing URLs Manually

To optimize an image, simply append parameters to the service URL:

```
GET /api/optimize?url={SOURCE_IMAGE_URL}&w={WIDTH}&q={QUALITY}&f={FORMAT}&client={CLIENT_ID}
```

| Parameter | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `url` | string | **Yes** | The full URL of the original image. | `https://example.com/hero.jpg` |
| `w` | number | No | Target width in pixels. | `800` |
| `q` | number | No | Quality (1-100) or `lossless`. Default: `80` | `90` |
| `f` | string | No | Format (`webp`, `avif`, `auto`). Default: `webp` | `avif` |
| `client` | string | No | Client ID for isolation/analytics. | `musefactory` |

**Example:**
```
https://your-service.vercel.app/api/optimize?url=https%3A%2F%2Fmysite.com%2Fimg.jpg&w=1200&f=webp&client=teemplot
```

### B. Using the Helper Utility (Recommended)

Copy the `image-optimizer.ts` (or `image-loader.ts`) file into your project's `src/lib` directory.

**Usage in React/Vue/TS:**

```typescript
import { getOptimizedUrl } from '@/lib/image-optimizer';

// In your component
const myImage = getOptimizedUrl({
  src: 'https://example.com/banner.png',
  width: 1200,
  quality: 90,
  format: 'avif'
});

return <img src={myImage} alt="Banner" />;
```

## 3. Client IDs

Use the appropriate `client` parameter for your project to ensure analytics and storage isolation work correctly:

*   **MuseFactory**: `musefactory`
*   **Teemplot**: `teemplot` (or `client-a`)
*   **UGlobalHorizons**: `uglobalhorizons` (or `client-b`)

## 4. Troubleshooting

*   **400 Invalid URL**: Ensure the `url` parameter is a valid, publicly accessible URL.
*   **401 Unauthorized**: If you implemented the monitoring dashboard, ensure you are using the correct access code.
*   **Images not updating**: The service caches heavily. Change the `q` or `w` slightly to force a re-optimization if you changed the source image but kept the URL the same.
