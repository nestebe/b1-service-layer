import axios from 'axios';

export type ServiceLayerErrorKind =
  /** The server answered with a non-2xx status. */
  | 'http'
  /** No response was received (network error, timeout, TLS...). */
  | 'network'
  /** The client was used incorrectly (no session, invalid config...). */
  | 'client';

export interface ServiceLayerErrorDetails {
  kind: ServiceLayerErrorKind;
  method?: string;
  path?: string;
  status?: number;
  /** Service Layer error code (`error.code` in the response body). */
  code?: number | string;
  /** Raw response body, if any. */
  body?: unknown;
}

/**
 * Error thrown by every client method.
 *
 * The original axios error is intentionally not attached: its request config
 * contains the session cookie and, for `Login`, the user password.
 */
export class ServiceLayerError extends Error {
  readonly kind: ServiceLayerErrorKind;
  readonly method?: string;
  readonly path?: string;
  readonly status?: number;
  readonly code?: number | string;
  readonly body?: unknown;

  constructor(message: string, details: ServiceLayerErrorDetails) {
    super(message);
    this.name = 'ServiceLayerError';
    this.kind = details.kind;
    this.method = details.method;
    this.path = details.path;
    this.status = details.status;
    this.code = details.code;
    this.body = details.body;
  }

  /** Builds a `ServiceLayerError` from anything thrown during a request. */
  static from(error: unknown, method: string, path: string): ServiceLayerError {
    if (error instanceof ServiceLayerError) return error;

    const context = `${method.toUpperCase()} ${path}`;

    if (axios.isAxiosError(error)) {
      if (error.response) {
        const { status } = error.response;
        const data: unknown = error.response.data;
        const parsed = parseServiceLayerBody(data);
        const detail = parsed.message ?? error.response.statusText;
        return new ServiceLayerError(
          `${context} failed with status ${status}${detail ? `: ${detail}` : ''}`,
          { kind: 'http', method, path, status, code: parsed.code, body: data }
        );
      }
      return new ServiceLayerError(`${context} failed: ${error.code ?? error.message}`, {
        kind: 'network',
        method,
        path,
        code: error.code
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    return new ServiceLayerError(`${context} failed: ${message}`, {
      kind: 'network',
      method,
      path
    });
  }
}

/**
 * Extracts code and message from a Service Layer error body.
 * v1: `{ error: { code, message: { lang, value } } }`
 * v2: `{ error: { code, message } }`
 */
export function parseServiceLayerBody(data: unknown): {
  code?: number | string;
  message?: string;
} {
  if (!isObject(data) || !isObject(data.error)) return {};
  const { code, message } = data.error;
  return {
    code: typeof code === 'number' || typeof code === 'string' ? code : undefined,
    message:
      typeof message === 'string'
        ? message
        : isObject(message) && typeof message.value === 'string'
          ? message.value
          : undefined
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
