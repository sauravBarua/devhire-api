import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '../../common/errors/app.exception';
import { parseEnv } from '../../config/env';
import { CloudinaryService } from './cloudinary.service';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  uploadStream: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('cloudinary', () => ({
  v2: {
    config: mocks.config,
    uploader: { upload_stream: mocks.uploadStream, destroy: mocks.destroy },
  },
}));

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};
const unconfigured = parseEnv(base);
const configured = parseEnv({
  ...base,
  CLOUDINARY_CLOUD_NAME: 'demo',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
});

interface UploadOutcome {
  error?: { message: string };
  uploaded?: { public_id: string; secure_url: string; bytes: number };
}

function stubUpload(outcome: UploadOutcome): void {
  mocks.uploadStream.mockImplementation(
    (
      _options: unknown,
      callback: (error?: { message: string }, uploaded?: object) => void,
    ) => ({
      end: () => callback(outcome.error, outcome.uploaded),
    }),
  );
}

const uploaded = {
  public_id: 'folder/abc',
  secure_url: 'https://res.example.test/abc',
  bytes: 3,
};

const uuidPdfName = (): string =>
  expect.stringMatching(/^[0-9a-f-]{36}\.pdf$/) as string;

beforeAll(() => {
  Logger.overrideLogger(false);
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('CloudinaryService without credentials', () => {
  it('refuses uploads with UPLOADS_NOT_CONFIGURED and never calls Cloudinary', async () => {
    const service = new CloudinaryService(unconfigured);
    for (const upload of [
      service.uploadImage(Buffer.from('x'), 'image/png', 'logos'),
      service.uploadPdf(Buffer.from('x'), 'cvs'),
    ]) {
      const error = await upload.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('UPLOADS_NOT_CONFIGURED');
      expect((error as AppException).getStatus()).toBe(503);
    }
    expect(mocks.uploadStream).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
  });

  it('ignores destroy', async () => {
    await new CloudinaryService(unconfigured).destroy('folder/abc');
    expect(mocks.destroy).not.toHaveBeenCalled();
  });
});

describe('CloudinaryService with credentials', () => {
  it('configures the SDK once with secure URLs', () => {
    new CloudinaryService(configured);
    expect(mocks.config).toHaveBeenCalledWith({
      cloud_name: 'demo',
      api_key: 'key',
      api_secret: 'secret',
      secure: true,
    });
  });

  it('uploads an image and returns only what we store', async () => {
    stubUpload({ uploaded });
    const stored = await new CloudinaryService(configured).uploadImage(
      Buffer.from('png'),
      'image/png',
      'devhire/logos',
    );
    expect(stored).toEqual({
      publicId: 'folder/abc',
      secureUrl: 'https://res.example.test/abc',
      size: 3,
      mime: 'image/png',
    });
    expect(mocks.uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'devhire/logos',
        resource_type: 'image',
      }),
      expect.any(Function),
    );
  });

  it('uploads a PDF as a raw file with an unguessable name', async () => {
    stubUpload({ uploaded });
    const stored = await new CloudinaryService(configured).uploadPdf(
      Buffer.from('pdf'),
      'devhire/cvs',
    );
    expect(stored.mime).toBe('application/pdf');
    expect(mocks.uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'devhire/cvs',
        resource_type: 'raw',
        public_id: uuidPdfName(),
      }),
      expect.any(Function),
    );
  });

  it('turns an upload failure into a 502 UPLOAD_FAILED', async () => {
    stubUpload({ error: { message: 'boom' } });
    const error = await new CloudinaryService(configured)
      .uploadPdf(Buffer.from('pdf'), 'devhire/cvs')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe('UPLOAD_FAILED');
    expect((error as AppException).getStatus()).toBe(502);
  });

  it('turns an empty response into UPLOAD_FAILED too', async () => {
    stubUpload({});
    await expect(
      new CloudinaryService(configured).uploadImage(
        Buffer.from('x'),
        'image/png',
        'logos',
      ),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('destroys with the right resource type and never throws', async () => {
    const service = new CloudinaryService(configured);
    mocks.destroy.mockResolvedValue({ result: 'ok' });
    await service.destroy('folder/abc.pdf', 'raw');
    expect(mocks.destroy).toHaveBeenCalledWith('folder/abc.pdf', {
      resource_type: 'raw',
    });

    mocks.destroy.mockRejectedValue(new Error('network down'));
    await expect(service.destroy('folder/abc')).resolves.toBeUndefined();
    expect(mocks.destroy).toHaveBeenLastCalledWith('folder/abc', {
      resource_type: 'image',
    });
  });
});
