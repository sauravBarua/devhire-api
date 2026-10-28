export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// identifies the image type from the file's first bytes, ignoring what the client declared
export function detectImageMime(buffer: Buffer): ImageMime | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE))
    return 'image/png';
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// returns the verified mime only when the declared type and the real bytes agree
export function resolveImageMime(
  declared: string,
  buffer: Buffer,
): ImageMime | null {
  const normalized =
    declared.toLowerCase() === 'image/jpg'
      ? 'image/jpeg'
      : declared.toLowerCase();
  const detected = detectImageMime(buffer);
  return detected !== null && detected === normalized ? detected : null;
}
