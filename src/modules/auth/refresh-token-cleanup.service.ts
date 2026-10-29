import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// Expired refresh tokens are useless, but revoked ones must stay until they expire so token reuse
// can still be detected. Deleting one day after expiry keeps that guarantee.
@Injectable()
export class RefreshTokenCleanupService {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'refresh-token-cleanup',
    timeZone: 'Europe/Paris',
  })
  async run(): Promise<void> {
    try {
      const removed = await this.purgeExpiredTokens();
      if (removed > 0)
        this.logger.log(`Deleted ${removed} expired refresh token(s)`);
    } catch (error) {
      this.logger.error(
        `Refresh token cleanup failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async purgeExpiredTokens(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - DAY_MS);
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return result.count;
  }
}
