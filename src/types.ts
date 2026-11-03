import type { AxiosRequestConfig } from 'axios';

/** Service Layer API version. */
export type ServiceLayerVersion = 'v1' | 'v2';

/** Minimal logger contract, compatible with `console`, pino, winston... */
export interface Logger {
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ServiceLayerConfig {
  /** Server URL including protocol, e.g. `https://sap-server`. */
  host: string;
  /** Company database name (`CompanyDB`). */
  company: string;
  /** SAP Business One user name. */
  username: string;
  /** SAP Business One password. */
  password: string;
  /**
   * Service Layer port. Default `50001`.
   * Set to `null` or `0` when the port is already part of `host` or a reverse proxy is used.
   */
  port?: number | null;
  /** Service Layer API version. Default `'v2'`. */
  version?: ServiceLayerVersion;
  /** Optional B1 language code sent at login (e.g. `22` for French). */
  language?: number;
  /**
   * Verify the server TLS certificate. Default `false`, because most Service Layer
   * installations use a self-signed certificate. Set to `true` when the certificate is trusted.
   */
  rejectUnauthorized?: boolean;
  /** Request timeout in milliseconds. Default `0` (no timeout). */
  timeout?: number;
  /** Log requests and session events through `logger`. Default `false`. */
  debug?: boolean;
  /** Logger used when `debug` is enabled and for warnings. Default `console`. */
  logger?: Logger;
}

/** Resolved configuration with defaults applied. */
export type ResolvedConfig = Required<Omit<ServiceLayerConfig, 'language' | 'port'>> &
  Pick<ServiceLayerConfig, 'language'> & { port: number | null };

/** Request options forwarded to axios (params, headers, timeout, signal...). */
export type RequestOptions = Omit<AxiosRequestConfig, 'url' | 'method' | 'data' | 'baseURL'>;

/** Body of a successful `POST Login` response. */
export interface LoginResponse {
  SessionId: string;
  /** Inactivity timeout of the session, in minutes. */
  SessionTimeout: number;
  Version?: string;
}

/** Information about the current session. */
export interface SessionInfo {
  sessionId: string;
  /** Inactivity timeout, in minutes. */
  timeoutMinutes: number;
  version?: string;
}

/** OData collection returned by the Service Layer (v1 and v2 keys). */
export interface ODataCollection<T> {
  value: T[];
  '@odata.nextLink'?: string;
  'odata.nextLink'?: string;
  [key: string]: unknown;
}
