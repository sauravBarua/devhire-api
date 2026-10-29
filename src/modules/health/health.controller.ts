import { Controller, Get, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { ShutdownState } from '../../infra/shutdown/shutdown.state';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly shutdown: ShutdownState,
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
    // during shutdown, tell the load balancer to stop sending traffic
    if (this.shutdown.isShuttingDown) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SHUTTING_DOWN',
        'Server is shutting down',
      );
    }
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.redis.ping(),
    ]);
    if (!database || !redis) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'A dependency is unavailable',
        { database: database ? 'up' : 'down', redis: redis ? 'up' : 'down' },
      );
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
