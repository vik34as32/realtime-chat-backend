import jwt, { type JwtPayload } from 'jsonwebtoken';

const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret === undefined || secret.trim() === '') {
    throw new Error('Missing required environment variable: JWT_SECRET');
  }
  return secret;
}

export function signToken(userId: number): string {
  return jwt.sign({ userId }, jwtSecret(), { expiresIn: TOKEN_LIFETIME_SECONDS });
}

export function readUserId(token: string): number | null {
  try {
    const payload: JwtPayload | string = jwt.verify(token, jwtSecret());
    if (typeof payload === 'string') {
      return null;
    }

    const userId = payload.userId;
    if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
      return null;
    }

    return userId;
  } catch {
    return null;
  }
}
