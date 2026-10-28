import { describe, expect, it } from 'vitest';
import { detectImageMime, resolveImageMime } from './image-signature';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(16),
]);
const webp = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.alloc(4),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(8),
]);

describe('detectImageMime', () => {
  it('detects png, jpeg and webp', () => {
    expect(detectImageMime(png)).toBe('image/png');
    expect(detectImageMime(jpeg)).toBe('image/jpeg');
    expect(detectImageMime(webp)).toBe('image/webp');
  });

  it('returns null for other content', () => {
    expect(detectImageMime(Buffer.from('%PDF-1.7 hello'))).toBeNull();
    expect(detectImageMime(Buffer.from('plain text'))).toBeNull();
    expect(detectImageMime(Buffer.alloc(0))).toBeNull();
  });
});

describe('resolveImageMime', () => {
  it('accepts when declared type and bytes agree', () => {
    expect(resolveImageMime('image/png', png)).toBe('image/png');
  });

  it('treats image/jpg as image/jpeg', () => {
    expect(resolveImageMime('image/jpg', jpeg)).toBe('image/jpeg');
  });

  it('rejects when the declared type lies about the bytes', () => {
    expect(resolveImageMime('image/png', jpeg)).toBeNull();
    expect(
      resolveImageMime('image/png', Buffer.from('not an image')),
    ).toBeNull();
  });

  it('rejects types outside the allowed list', () => {
    expect(
      resolveImageMime('application/pdf', Buffer.from('%PDF-1.7')),
    ).toBeNull();
  });
});
