import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { AppException } from '../../common/errors/app.exception';
import { ENV, type Env } from '../../config/env';

export interface StoredFile {
  publicId: string;
  secureUrl: string;
  size: number;
  mime: string;
}

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

  async uploadImage(
    buffer: Buffer,
    mime: string,
    folder: string,
  ): Promise<StoredFile> {
    this.assertConfigured();
    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder, resource_type: 'image' },
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

  // best effort: a failed cleanup must never fail the request
  async destroy(publicId: string): Promise<void> {
    if (!this.configured) return;
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      this.logger.warn(
        `Could not delete ${publicId}: ${error instanceof Error ? error.message : 'unknown'}`,
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
