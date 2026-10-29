import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from '../openapi/openapi';

// Runs from the compiled output (pnpm openapi:export): the controllers need the decorator metadata that
// only the TypeScript compiler emits. Preview mode builds the module graph without connecting to
// Postgres, Redis or SMTP, so this works anywhere, including CI.
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  const document = buildOpenApiDocument(app);
  const target = resolve(process.cwd(), 'openapi.json');
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(
    `OpenAPI written to ${target} (${Object.keys(document.paths).length} paths)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
