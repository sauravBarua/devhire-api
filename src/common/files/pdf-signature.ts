const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

export function isPdf(buffer: Buffer): boolean {
  return (
    buffer.length >= PDF_MAGIC.length &&
    buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
  );
}

// returns the verified mime only when the declared type and the real bytes agree
export function resolvePdfMime(
  declared: string,
  buffer: Buffer,
): 'application/pdf' | null {
  return declared.toLowerCase() === 'application/pdf' && isPdf(buffer)
    ? 'application/pdf'
    : null;
}
