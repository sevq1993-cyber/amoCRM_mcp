export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options?: { statusCode?: number; code?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = "AppError";
    this.statusCode = options?.statusCode ?? 500;
    this.code = options?.code ?? "internal_error";
    this.details = options?.details;
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

export function ensure(
  condition: unknown,
  message: string,
  options?: { statusCode?: number; code?: string; details?: Record<string, unknown> },
): asserts condition {
  if (!condition) {
    throw new AppError(message, options);
  }
}

export const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : JSON.stringify(error));
};
