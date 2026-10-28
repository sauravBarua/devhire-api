import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { AppException } from '../errors/app.exception';

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'TOO_MANY_REQUESTS',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string') return body;
  if (isRecord(body)) {
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) return body.message.join('; ');
  }
  return fallback;
}

function extractIssues(body: unknown): unknown {
  if (!isRecord(body) || !Array.isArray(body.errors)) return undefined;
  return body.errors.map((issue: unknown) => ({
    path:
      isRecord(issue) && Array.isArray(issue.path) ? issue.path.join('.') : '',
    message:
      isRecord(issue) && typeof issue.message === 'string'
        ? issue.message
        : 'Invalid value',
  }));
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const error = this.normalize(exception);
    const requestId = res.getHeader('x-request-id');

    if (error.status >= 500) {
      this.logger.error(
        error.message,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.status(error.status).json({
      statusCode: error.status,
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
      requestId: typeof requestId === 'string' ? requestId : undefined,
      path: req.originalUrl,
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof ZodValidationException) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: extractIssues(exception.getResponse()),
      };
    }
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: STATUS_CODES[status] ?? `HTTP_${status}`,
        message: extractMessage(exception.getResponse(), exception.message),
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }
}
