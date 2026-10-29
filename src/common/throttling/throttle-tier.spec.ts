import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ThrottleTier, createLimitResolver } from './throttle-tier';

class Sample {
  @ThrottleTier('strict')
  strictRoute(): void {}

  normalRoute(): void {}
}

@ThrottleTier('strict')
class StrictController {
  anyRoute(): void {}
}

// the resolver only reads the handler and class metadata, so a method looked up by name is enough
const contextFor = (
  controller: new () => object,
  method: string,
): ExecutionContext => {
  const handler = (controller.prototype as Record<string, () => void>)[method];
  return {
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
};

describe('createLimitResolver', () => {
  const resolve = createLimitResolver({ limit: 100, strictLimit: 10 });

  it('uses the strict limit on routes marked strict', () => {
    expect(resolve(contextFor(Sample, 'strictRoute'))).toBe(10);
  });

  it('uses the general limit everywhere else', () => {
    expect(resolve(contextFor(Sample, 'normalRoute'))).toBe(100);
  });

  it('honours the marker on a whole controller', () => {
    expect(resolve(contextFor(StrictController, 'anyRoute'))).toBe(10);
  });
});
