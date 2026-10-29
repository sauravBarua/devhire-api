import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../../config/env';
import { AppException } from '../errors/app.exception';

// CSRF defence in depth for the cookie-based endpoints (refresh, logout): a browser always sends
// Origin on cross-site POSTs, so an Origin that is not on the allow-list is refused.
// Requests without Origin (curl, Postman, server-to-server) are not browser CSRF and pass.
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(@Inject(ENV) env: Env) {
    this.allowed = new Set(env.CORS_ORIGINS);
  }

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;
    if (origin === undefined || this.allowed.has(origin)) return true;
    throw new AppException(
      HttpStatus.FORBIDDEN,
      'AUTH_ORIGIN_FORBIDDEN',
      'Origin not allowed',
    );
  }
}
