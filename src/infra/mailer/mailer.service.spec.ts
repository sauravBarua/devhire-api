import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env';
import { MailerService } from './mailer.service';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.createTransport },
}));

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};
const message = {
  to: 'alice@example.com',
  subject: 'Sujet',
  html: '<p>Bonjour</p>',
  text: 'Bonjour',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  mocks.sendMail.mockResolvedValue({});
});

describe('MailerService', () => {
  it('talks to MailHog by default, without authentication', () => {
    new MailerService(parseEnv(base));
    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
      auth: undefined,
    });
  });

  it('authenticates only when both user and password are set', () => {
    new MailerService(
      parseEnv({
        ...base,
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
      }),
    );
    expect(mocks.createTransport).toHaveBeenLastCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
    });

    new MailerService(parseEnv({ ...base, SMTP_USER: 'u' }));
    expect(mocks.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it('sends from the configured address', async () => {
    await new MailerService(
      parseEnv({ ...base, MAIL_FROM: 'DevHire <hello@devhire.test>' }),
    ).send(message);
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: 'DevHire <hello@devhire.test>',
      ...message,
    });
  });

  it('lets send errors reach the queue so the job is retried', async () => {
    mocks.sendMail.mockRejectedValue(new Error('smtp down'));
    await expect(
      new MailerService(parseEnv(base)).send(message),
    ).rejects.toThrow('smtp down');
  });
});
