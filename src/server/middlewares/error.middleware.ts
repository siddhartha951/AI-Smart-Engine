import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isOperational = err instanceof AppError && err.isOperational;
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const errorCode = err instanceof AppError ? err.code : 'INTERNAL_SERVER_ERROR';

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
      message: isOperational ? err.message : 'An unexpected error occurred. Please try again later.',
    },
  });
}
