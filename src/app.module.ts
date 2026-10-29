import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AppConfigModule } from './config/config.module';
import { QueueModule } from './infra/bullmq/queue.module';
import { CloudinaryModule } from './infra/cloudinary/cloudinary.module';
import { AppLoggerModule } from './infra/logger/logger.module';
import { MailerModule } from './infra/mailer/mailer.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
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
    AppLoggerModule,
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
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // order matters: authenticate first, then check roles
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
