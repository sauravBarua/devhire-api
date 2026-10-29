function prismaCode(error: unknown): string | null {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}

export function isUniqueViolation(error: unknown): boolean {
  return prismaCode(error) === 'P2002';
}

export function isForeignKeyViolation(error: unknown): boolean {
  return prismaCode(error) === 'P2003';
}
