import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/errors';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  if (isInvalidJson(err)) {
    res.status(400).json({
      success: false,
      message: 'Request body must be valid JSON',
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
}

function isInvalidJson(err: unknown): boolean {
  return err instanceof SyntaxError && errorStatus(err) === 400;
}

function errorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) {
    return null;
  }

  return typeof err.status === 'number' ? err.status : null;
}
