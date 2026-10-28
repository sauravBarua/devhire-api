import type { Role } from '../../generated/prisma/enums';

export interface AuthUser {
  id: string;
  role: Role;
}
