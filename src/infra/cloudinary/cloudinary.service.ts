import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  v2 as cloudinary,
  type UploadApiOptions,
  type UploadApiResponse,
} from 'cloudinary';
import { AppException } from '../../common/errors/app.exception';
import { ENV, type Env } from '../../config/env';

export interface StoredFile {
  publicId: string;
  secureUrl: string;
  size: number;
  mime: string;
}

export type CloudinaryResourceType = 'image' | 'raw';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly configured: boolean;

  constructor(@Inject(ENV) env: Env) {
    const cloudName = env.CLOUDINARY_CLOUD_NAME;
    const apiKey = env.CLOUDINARY_API_KEY;
    const apiSecret = env.CLOUDINARY_API_SECRET;
    this.configured = Boolean(cloudName && apiKey && apiSecret);
    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    }
  }

  uploadImage(
    buffer: Buffer,
    mime: string,
    folder: string,
  ): Promise<StoredFile> {
    return this.upload(buffer, mime, { folder, resource_type: 'image' });
  }

  // PDFs go up as "raw" files; the random public id keeps the .pdf extension in the URL
  uploadPdf(buffer: Buffer, folder: string): Promise<StoredFile> {
    return this.upload(buffer, 'application/pdf', {
      folder,
      resource_type: 'raw',
      public_id: `${randomUUID()}.pdf`,
    });
  }

  // best effort: a failed cleanup must never fail the request
  async destroy(
    publicId: string,
    resourceType: CloudinaryResourceType = 'image',
  ): Promise<void> {
    if (!this.configured) return;
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
      });
    } catch (error) {
      this.logger.warn(
        `Could not delete ${publicId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async upload(
    buffer: Buffer,
    mime: string,
    options: UploadApiOptions,
  ): Promise<StoredFile> {
    this.assertConfigured();
    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          options,
          (error, uploaded) => {
            if (error || !uploaded) {
              reject(new Error(error?.message ?? 'Empty Cloudinary response'));
              return;
            }
            resolve(uploaded);
          },
        );
        stream.end(buffer);
      });
      return {
        publicId: result.public_id,
        secureUrl: result.secure_url,
        size: result.bytes,
        mime,
      };
    } catch (error) {
      this.logger.error(
        `Cloudinary upload failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new AppException(
        HttpStatus.BAD_GATEWAY,
        'UPLOAD_FAILED',
        'File upload failed',
      );
    }
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'UPLOADS_NOT_CONFIGURED',
        'File uploads are not configured',
      );
    }
  }
}
