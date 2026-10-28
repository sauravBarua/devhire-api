import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';

// shared by main.ts and the e2e tests so both run the same HTTP setup
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
}
