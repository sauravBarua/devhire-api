import { describe, expect, it } from 'vitest';
import { isPdf, resolvePdfMime } from './pdf-signature';

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)]);

describe('isPdf', () => {
  it('detects the PDF signature', () => {
    expect(isPdf(pdf)).toBe(true);
  });

  it('rejects other content and short buffers', () => {
    expect(isPdf(Buffer.from('plain text'))).toBe(false);
    expect(isPdf(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isPdf(Buffer.from('%PDF'))).toBe(false);
    expect(isPdf(Buffer.alloc(0))).toBe(false);
  });
});

describe('resolvePdfMime', () => {
  it('accepts when declared type and bytes agree', () => {
    expect(resolvePdfMime('application/pdf', pdf)).toBe('application/pdf');
    expect(resolvePdfMime('Application/PDF', pdf)).toBe('application/pdf');
  });

  it('rejects when the declared type lies about the bytes', () => {
    expect(
      resolvePdfMime('application/pdf', Buffer.from('not a pdf')),
    ).toBeNull();
  });

  it('rejects a PDF declared as something else', () => {
    expect(resolvePdfMime('image/png', pdf)).toBeNull();
    expect(resolvePdfMime('application/octet-stream', pdf)).toBeNull();
  });
});
