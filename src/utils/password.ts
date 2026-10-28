import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function passwordsMatch(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) {
    return false;
  }

  const next = scryptSync(password, salt, 32);
  const saved = Buffer.from(hash, 'hex');
  if (saved.length !== next.length) {
    return false;
  }

  return timingSafeEqual(saved, next);
}
