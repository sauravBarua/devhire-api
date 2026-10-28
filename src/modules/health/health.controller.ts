import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{
    status: 'ok';
    checks: { database: 'up'; redis: 'up' };
  }> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.redis.ping(),
    ]);
    if (!database || !redis) {
      throw new ServiceUnavailableException({
        status: 'error',
        checks: {
          database: database ? 'up' : 'down',
          redis: redis ? 'up' : 'down',
        },
      });
    }
    return { status: 'ok', checks: { database: 'up', redis: 'up' } };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
