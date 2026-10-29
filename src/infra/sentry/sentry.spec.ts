import { describe, expect, it } from 'vitest';
import { scrubEvent } from './sentry';

describe('scrubEvent', () => {
  it('removes cookies, body, auth headers and the user', () => {
    const event = scrubEvent({
      message: 'boom',
      user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
      request: {
        url: 'http://x/api/v1/auth/login',
        method: 'POST',
        cookies: { refresh_token: 'secret' },
        data: { password: 'secret' },
        headers: {
          authorization: 'Bearer secret',
          cookie: 'refresh_token=secret',
          'user-agent': 'curl',
        },
      },
    });

    expect(event.user).toBeUndefined();
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.data).toBeUndefined();
    expect(event.request.headers).toEqual({ 'user-agent': 'curl' });
    expect(event.request.url).toBe('http://x/api/v1/auth/login');
    expect(event.message).toBe('boom');
  });

  it('copes with events that have no request', () => {
    expect(scrubEvent({ message: 'plain' })).toEqual({ message: 'plain' });
  });

  it('copes with a request that has no headers', () => {
    expect(scrubEvent({ request: { cookies: { a: 'b' } } })).toEqual({
      request: {},
    });
  });
});
