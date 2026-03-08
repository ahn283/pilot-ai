/**
 * Unified error hierarchy for pilot-ai.
 * Each error includes a machine-readable code, a user-friendly message, and optional cause.
 */

export class PilotError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(message: string, options?: { code?: string; userMessage?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'PilotError';
    this.code = options?.code ?? 'PILOT_ERROR';
    this.userMessage = options?.userMessage ?? message;
  }
}

export class AuthError extends PilotError {
  constructor(message: string, options?: { code?: string; userMessage?: string; cause?: unknown }) {
    super(message, {
      code: options?.code ?? 'AUTH_ERROR',
      userMessage: options?.userMessage ?? 'Authentication failed. Please check your credentials.',
      cause: options?.cause,
    });
    this.name = 'AuthError';
  }
}

export class ToolError extends PilotError {
  constructor(message: string, options?: { code?: string; userMessage?: string; cause?: unknown }) {
    super(message, {
      code: options?.code ?? 'TOOL_ERROR',
      userMessage: options?.userMessage ?? 'A tool operation failed. Please try again.',
      cause: options?.cause,
    });
    this.name = 'ToolError';
  }
}

export class ConfigError extends PilotError {
  constructor(message: string, options?: { code?: string; userMessage?: string; cause?: unknown }) {
    super(message, {
      code: options?.code ?? 'CONFIG_ERROR',
      userMessage: options?.userMessage ?? 'Configuration error. Run "pilot-ai init" to fix.',
      cause: options?.cause,
    });
    this.name = 'ConfigError';
  }
}

export class ExternalApiError extends PilotError {
  readonly statusCode?: number;

  constructor(message: string, options?: { code?: string; userMessage?: string; cause?: unknown; statusCode?: number }) {
    super(message, {
      code: options?.code ?? 'EXTERNAL_API_ERROR',
      userMessage: options?.userMessage ?? 'An external service is temporarily unavailable.',
      cause: options?.cause,
    });
    this.name = 'ExternalApiError';
    this.statusCode = options?.statusCode;
  }
}

export class TimeoutError extends PilotError {
  constructor(message: string, options?: { code?: string; userMessage?: string; cause?: unknown }) {
    super(message, {
      code: options?.code ?? 'TIMEOUT_ERROR',
      userMessage: options?.userMessage ?? 'The operation timed out. Please try again.',
      cause: options?.cause,
    });
    this.name = 'TimeoutError';
  }
}

/**
 * Returns a user-friendly message for any error.
 */
export function getUserMessage(error: unknown): string {
  if (error instanceof PilotError) {
    return error.userMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
