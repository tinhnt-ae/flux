import axios from 'axios';
import type { CommandErrorCode } from '../types/domain';

export class AppError extends Error {
  readonly code: CommandErrorCode;
  readonly status?: number;
  readonly details?: unknown;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: {
      code: CommandErrorCode;
      status?: number;
      details?: unknown;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function missingApiKeyError(): AppError {
  return new AppError('NO_API_KEY', { code: 'NO_API_KEY' });
}

export function toFactStreamError(error: unknown): AppError {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      return new AppError(`FactStream request failed (${error.response.status})`, {
        code: 'API_ERROR',
        status: error.response.status,
        details: error.response.data,
        cause: error
      });
    }
    return new AppError('Unable to reach FactStream API', {
      code: 'NETWORK_ERROR',
      cause: error
    });
  }

  if (error instanceof Error) {
    return new AppError(error.message, {
      code: 'NETWORK_ERROR',
      cause: error
    });
  }

  return new AppError('Unable to reach FactStream API', {
    code: 'NETWORK_ERROR',
    details: error
  });
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function hasCommandErrorCode(error: unknown, code: CommandErrorCode): boolean {
  return error instanceof AppError && error.code === code;
}
