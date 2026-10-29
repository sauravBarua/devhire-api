import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// unit and e2e tests together: most service logic needs a real database, so only e2e tests cover it
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/modules/**/*.ts',
        'src/common/**/*.ts',
        'src/infra/cloudinary/**/*.ts',
        'src/infra/mailer/**/*.ts',
        'src/infra/sentry/**/*.ts',
      ],
      exclude: [
        '**/*.spec.ts',
        '**/*.module.ts',
        '**/*.controller.ts',
        '**/*.types.ts',
        '**/dto/**',
        'src/modules/skills/skills.data.ts',
        'src/common/types/**',
        'src/common/decorators/**',
      ],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
