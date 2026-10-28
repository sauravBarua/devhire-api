import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { AppException } from '../../common/errors/app.exception';
import { ENV, type Env } from '../../config/env';
import type { User } from '../../generated/prisma/client';
import type { Role } from '../../generated/prisma/enums';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  createdAt: Date;
}

export interface Session {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

@Injectable()
export class AuthService {
  // compared against when the email is unknown, so response time does not reveal which emails exist
  private readonly dummyHash: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.dummyHash = bcrypt.hashSync('dummy-password', env.BCRYPT_ROUNDS);
  }

  async register(dto: RegisterDto): Promise<Session> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw this.emailTaken();

    const passwordHash = await bcrypt.hash(
      dto.password,
      this.env.BCRYPT_ROUNDS,
    );
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: dto.role,
        },
      });
      return await this.issueSession(user, randomUUID());
    } catch (error) {
      if (isUniqueViolation(error)) throw this.emailTaken();
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<Session> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    const valid = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? this.dummyHash,
    );
    if (!user || !valid) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_INVALID_CREDENTIALS',
        'Invalid email or password',
      );
    }
    return this.issueSession(user, randomUUID());
  }

  async refresh(rawToken: string | undefined): Promise<Session> {
    if (!rawToken)
      throw this.refreshError(
        'AUTH_REFRESH_INVALID',
        'Refresh token is missing',
      );

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!stored)
      throw this.refreshError(
        'AUTH_REFRESH_INVALID',
        'Refresh token is invalid',
      );

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw this.refreshError(
        'AUTH_REFRESH_REUSED',
        'Refresh token was already used',
      );
    }
    if (stored.expiresAt <= new Date()) {
      throw this.refreshError(
        'AUTH_REFRESH_EXPIRED',
        'Refresh token has expired',
      );
    }

    // atomic claim: only one concurrent request can rotate this token
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(stored.familyId);
      throw this.refreshError(
        'AUTH_REFRESH_REUSED',
        'Refresh token was already used',
      );
    }
    return this.issueSession(stored.user, stored.familyId);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_UNAUTHORIZED',
        'Authentication required',
      );
    }
    return this.toPublicUser(user);
  }

  private async issueSession(user: User, familyId: string): Promise<Session> {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
    });
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: refreshExpiresAt,
      },
    });
    return {
      user: this.toPublicUser(user),
      accessToken,
      refreshToken,
      refreshExpiresAt,
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      createdAt: user.createdAt,
    };
  }

  private emailTaken(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      'AUTH_EMAIL_TAKEN',
      'Email is already registered',
    );
  }

  private refreshError(code: string, message: string): AppException {
    return new AppException(HttpStatus.UNAUTHORIZED, code, message);
  }
}
