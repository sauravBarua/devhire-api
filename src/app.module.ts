import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { createLimitResolver } from './common/throttling/throttle-tier';
import { AppConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { QueueModule } from './infra/bullmq/queue.module';
import { CloudinaryModule } from './infra/cloudinary/cloudinary.module';
import { AppLoggerModule } from './infra/logger/logger.module';
import { MailerModule } from './infra/mailer/mailer.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { ShutdownModule } from './infra/shutdown/shutdown.module';
import { AdminModule } from './modules/admin/admin.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { SavedModule } from './modules/saved/saved.module';
import { SearchModule } from './modules/search/search.module';
import { SkillsModule } from './modules/skills/skills.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [
          {
            name: 'default',
            ttl: env.THROTTLE_TTL_SECONDS * 1000,
            limit: createLimitResolver({
              limit: env.THROTTLE_LIMIT,
              strictLimit: env.THROTTLE_STRICT_LIMIT,
            }),
          },
        ],
      }),
    }),
    AppLoggerModule,
    ShutdownModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    MailerModule,
    CloudinaryModule,
    AuthModule,
    CompaniesModule,
    SkillsModule,
    JobsModule,
    SearchModule,
    ApplicationsModule,
    SavedModule,
    AlertsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // order matters: throttle first (cheapest rejection), then authenticate, then check roles
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
