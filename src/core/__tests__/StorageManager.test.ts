import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ConfigurationManager } from '../ConfigurationManager';
import { StorageManager } from '../StorageManager';

describe('StorageManager', () => {
  it('uploads to local storage when configured', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-pipeline-'));
    try {
      const config = new ConfigurationManager({
        local: { rootPath: dir, publicUrl: 'http://localhost/files' },
        email: {
          host: 'example',
          port: 587,
          user: 'user',
          pass: 'pass',
          from: 'from@example.com',
          adminEmail: 'admin@example.com',
        },
        optimization: {
          maxWidth: 2000,
          quality: 'auto:good',
          formats: ['auto'],
          maxFileSize: 10_000_000,
        },
        delivery: {
          enableLazyLoading: true,
          responsiveBreakpoints: [320, 640, 1024],
          cacheUrls: true,
        },
      });

      const storage = new StorageManager(config);
      const buffer = Buffer.from('hello');
      const result = await storage.upload(buffer, {
        provider: 'local',
        publicId: 'test.txt',
        context: { contentType: 'text/plain' },
      });

      expect(result.publicId).toBe('test.txt');
      expect(result.secureUrl).toBe('http://localhost/files/test.txt');
      await expect(fs.readFile(path.join(dir, 'test.txt'), 'utf8')).resolves.toBe('hello');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
