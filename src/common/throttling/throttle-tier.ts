import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export type ThrottleTierName = 'strict';

export const THROTTLE_TIER_KEY = 'throttleTier';

export const ThrottleTier = (
  tier: ThrottleTierName,
): MethodDecorator & ClassDecorator => SetMetadata(THROTTLE_TIER_KEY, tier);

export interface ThrottleLimits {
  limit: number;
  strictLimit: number;
}

// resolves the request limit per route: strict routes (login, register, refresh, apply) get the low limit
export function createLimitResolver(
  limits: ThrottleLimits,
): (context: ExecutionContext) => number {
  const reflector = new Reflector();
  return (context) => {
    const tier = reflector.getAllAndOverride<ThrottleTierName | undefined>(
      THROTTLE_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );
    return tier === 'strict' ? limits.strictLimit : limits.limit;
  };
}
