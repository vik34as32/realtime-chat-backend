import { HttpError } from './errors';

export function requiredText(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `${fieldName} is required`);
  }
  return value.trim();
}

export function readJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export function parseUserId(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive integer`);
  }
  return value;
}

export function parseRouteId(value: unknown, fieldName: string): number {
  const raw = typeof value === 'string' ? value : '';
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive integer`);
  }
  return id;
}

export function parseMessageId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('/')) {
    throw new HttpError(400, 'messageId is required');
  }
  return value.trim();
}

export function parseMessageText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'text is required');
  }
  return value.trim();
}

export function parseLimit(value: unknown): number {
  if (value === undefined || value === '') {
    return 50;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, 'limit must be from 1 to 100');
  }
  return limit;
}

export function parseDirection(value: unknown): 'before' | 'after' | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (value === 'before' || value === 'after') {
    return value;
  }
  throw new HttpError(400, 'direction must be before or after');
}

export function parseCursor(value: unknown): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Invalid pagination cursor');
  }
  return value;
}
