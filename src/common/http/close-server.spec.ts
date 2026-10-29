import { createServer, get, Agent, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { closeHttpServer } from './close-server';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });

function request(port: number, agent: Agent | false): Promise<string> {
  return new Promise((resolve, reject) => {
    get({ port, agent }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

describe('closeHttpServer', () => {
  it('lets an in-flight request finish before resolving', async () => {
    const server = createServer((_req, res) => {
      setTimeout(() => res.end('done'), 150);
    });
    const port = await listen(server);

    const response = request(port, false);
    await sleep(40);
    await closeHttpServer(server);

    expect(await response).toBe('done');
  });

  it('does not hang on an idle keep-alive connection', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    const port = await listen(server);
    const agent = new Agent({ keepAlive: true });

    expect(await request(port, agent)).toBe('ok');
    await closeHttpServer(server);
    agent.destroy();
  });

  it('refuses new connections after closing', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    const port = await listen(server);
    await closeHttpServer(server);

    await expect(request(port, false)).rejects.toThrow();
  });
});
