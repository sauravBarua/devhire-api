import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { Role } from '../generated/prisma/enums';
import {
  CONTROLLER_DOCS,
  type ControllerDocs,
  type OperationSpec,
  type UploadBody,
} from './operations';
import { RESPONSE_MODELS } from './schemas';

// the document types are derived from the one type Swagger exports from its main entry
type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;
type ParameterEntry = NonNullable<OperationObject['parameters']>[number];
type ResponseEntry = NonNullable<OperationObject['responses']>[string];
type JsonObject = Record<string, unknown>;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const reflector = new Reflector();

export const operationIdOf = (
  controllerName: string,
  handler: string,
): string => `${controllerName.replace(/Controller$/, '')}_${handler}`;

const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });

// every operation can fail with the standard error shape (see all-exceptions.filter.ts)
const ERROR_RESPONSE: ResponseEntry = {
  description: 'Error. "code" is a stable, machine-readable identifier.',
  content: { 'application/json': { schema: schemaRef('ErrorResponse') } },
};

const REFRESH_COOKIE: ParameterEntry = {
  name: 'refresh_token',
  in: 'cookie',
  required: false,
  description:
    'httpOnly cookie set by register and login; the browser sends it automatically.',
  schema: { type: 'string' },
};

const UPLOAD_BODIES: Record<UploadBody, JsonObject> = {
  logo: {
    type: 'object',
    required: ['file'],
    properties: {
      file: {
        type: 'string',
        format: 'binary',
        description: 'PNG, JPEG or WebP image, 2 MB max.',
      },
    },
  },
  cv: {
    type: 'object',
    required: ['cv'],
    properties: {
      cv: {
        type: 'string',
        format: 'binary',
        description: 'PDF file, 5 MB max.',
      },
      coverLetter: { type: 'string', maxLength: 5000 },
    },
  },
};

function handlerNames(controller: Type<unknown>): string[] {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype).filter((name) => {
    const member = prototype[name];
    return (
      typeof member === 'function' &&
      Reflect.getMetadata(METHOD_METADATA, member) !== undefined
    );
  });
}

function indexOperations(
  document: OpenAPIObject,
): Map<string, OperationObject> {
  const operations = new Map<string, OperationObject>();
  for (const item of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (operation?.operationId)
        operations.set(operation.operationId, operation);
    }
  }
  return operations;
}

function successResponse(spec: OperationSpec): ResponseEntry {
  if (!spec.schema) return { description: 'No content' };
  const schema: JsonObject = spec.array
    ? { type: 'array', items: schemaRef(spec.schema) }
    : schemaRef(spec.schema);
  return {
    description: 'Success',
    content: { 'application/json': { schema } },
  };
}

function describeOperation(
  operation: OperationObject,
  docs: ControllerDocs,
  handler: string,
  spec: OperationSpec,
): void {
  const target = (
    docs.controller.prototype as Record<string, (...args: never[]) => unknown>
  )[handler];
  const isPublic =
    reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      target,
      docs.controller,
    ]) === true;
  const roles = reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
    target,
    docs.controller,
  ]);

  operation.tags = [docs.tag];
  // public routes opt out of the global bearer requirement
  operation.security = isPublic ? [] : [{ bearer: [] }];
  if (roles && roles.length > 0)
    operation.description = `Requires role: ${roles.join(' or ')}.`;
  operation.responses = {
    [String(spec.status)]: successResponse(spec),
    default: ERROR_RESPONSE,
  };

  if (spec.upload) {
    operation.requestBody = {
      required: true,
      content: {
        'multipart/form-data': { schema: UPLOAD_BODIES[spec.upload] },
      },
    };
  }
  if (spec.cookie)
    operation.parameters = [...(operation.parameters ?? []), REFRESH_COOKIE];
}

// Paths are relative to the /api/v1 server. Request bodies and query parameters come from the Zod DTOs
// of the controllers; responses, tags and security come from operations.ts and the guards' metadata.
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('DevHire API')
    .setDescription(
      'REST API of DevHire, a job board for web development jobs. Paths are relative to the /api/v1 server.',
    )
    .setVersion('1.0.0')
    .addServer('/api/v1')
    .addBearerAuth()
    .build();

  const generated = SwaggerModule.createDocument(app, config, {
    ignoreGlobalPrefix: true,
    extraModels: RESPONSE_MODELS,
    operationIdFactory: operationIdOf,
  });
  const document = cleanupOpenApiDoc(generated);
  document.tags = [...new Set(CONTROLLER_DOCS.map(({ tag }) => tag))].map(
    (name) => ({ name }),
  );

  const operations = indexOperations(document);
  for (const docs of CONTROLLER_DOCS) {
    const handlers = handlerNames(docs.controller);
    const documented = Object.keys(docs.operations);
    const missing = handlers.filter((handler) => !documented.includes(handler));
    const unknown = documented.filter((handler) => !handlers.includes(handler));
    if (missing.length > 0 || unknown.length > 0) {
      throw new Error(
        `OpenAPI: ${docs.controller.name} is out of sync with operations.ts` +
          ` (missing: ${missing.join(', ') || '-'}; unknown: ${unknown.join(', ') || '-'})`,
      );
    }
    for (const handler of handlers) {
      const id = operationIdOf(docs.controller.name, handler);
      const operation = operations.get(id);
      if (!operation)
        throw new Error(`OpenAPI: operation ${id} was not generated`);
      describeOperation(operation, docs, handler, docs.operations[handler]);
    }
  }
  return document;
}

export function setupDocs(app: INestApplication): void {
  // not under the global prefix: /docs and /docs-json
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    customSiteTitle: 'DevHire API',
  });
}
