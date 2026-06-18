export type ErrorCode =
  | 'MASTRA_UNREACHABLE'
  | 'DATABRICKS_TIMEOUT'
  | 'INVALID_FRAME'
  | 'SESSION_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR';

export interface ErrorPayload {
  errorCode: ErrorCode;
  message: string;
  retryable: boolean;
}

export const ERROR_DEFINITIONS: Record<ErrorCode, { message: string; retryable: boolean; status: number }> = {
  MASTRA_UNREACHABLE: {
    message: 'Mastra server is unreachable. Please try again.',
    retryable: true,
    status: 503
  },
  DATABRICKS_TIMEOUT: {
    message: 'Databricks job timed out. Please rerun the analysis.',
    retryable: true,
    status: 504
  },
  INVALID_FRAME: {
    message: 'Request is missing required fields or is malformed.',
    retryable: false,
    status: 400
  },
  SESSION_NOT_FOUND: {
    message: 'Session not found. Please start a new session.',
    retryable: false,
    status: 403
  },
  UNAUTHORIZED: {
    message: 'Authentication failed. Please re-authenticate.',
    retryable: false,
    status: 401
  },
  INTERNAL_ERROR: {
    message: 'An internal server error occurred.',
    retryable: false,
    status: 500
  }
};

export function buildError(
  errorCode: ErrorCode,
  conversationId: string | null,
  customMessage?: string
) {
  const def = ERROR_DEFINITIONS[errorCode];
  return {
    type: 'error' as const,
    conversationId: conversationId,
    payload: {
      errorCode,
      message: customMessage || def.message,
      retryable: def.retryable
    }
  };
}

export function getStatusCode(errorCode: ErrorCode): number {
  return ERROR_DEFINITIONS[errorCode].status;
}

export function buildSSEEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}