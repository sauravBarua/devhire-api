import type { Server } from 'node:http';

// stops accepting connections, lets in-flight requests finish, and drops idle keep-alive sockets
export function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}
