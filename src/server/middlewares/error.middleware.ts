import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isOperational = err instanceof AppError && err.isOperational;
  let statusCode = err instanceof AppError ? err.statusCode : 500;
  let errorCode = err instanceof AppError ? err.code : 'INTERNAL_SERVER_ERROR';
  let message: string | undefined;

  // Zod schema validation failures (request body/query shape) are client
  // errors, not 500s. Without this mapping, a single malformed widget event
  // payload turns into "An unexpected error occurred" + log spam.
  if (err instanceof z.ZodError) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = err.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
  }

  logger.error(
    `Request Error: ${err.message}`,
    err,
    {
      storeId: req.storeId,
      path: req.path,
      method: req.method,
      statusCode,
    }
  );

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message:
        message ??
        (isOperational ? err.message : 'An unexpected error occurred. Please try again later.'),
    },
  });
}
