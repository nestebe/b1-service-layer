import https from 'node:https';
import axios, { AxiosHeaders, type AxiosInstance, type Method } from 'axios';

import { ServiceLayerError } from './errors.js';
import { Session } from './session.js';
import type {
  LoginResponse,
  ODataCollection,
  RequestOptions,
  ResolvedConfig,
  ServiceLayerConfig,
  SessionInfo
} from './types.js';
import { buildBaseUrl, toRelativePath } from './url.js';

const DEFAULTS = {
  port: 50001,
  version: 'v2',
  rejectUnauthorized: false,
  timeout: 0,
  debug: false
} as const;

/** Options of {@link ServiceLayer.find}. */
export interface FindOptions extends RequestOptions {
  /** Stop after this number of pages. Default: no limit. */
  maxPages?: number;
}

/**
 * Client for the SAP Business One Service Layer.
 *
 * - logs in lazily and renews the session before it expires;
 * - logs in again and replays the request once when the server answers 401;
 * - throws a {@link ServiceLayerError} on any failure.
 */
export class ServiceLayer {
  private userConfig?: ServiceLayerConfig;
  private config?: ResolvedConfig;
  private http?: AxiosInstance;
  private session?: Session;
  private pendingLogin?: Promise<Session>;

  constructor(config?: ServiceLayerConfig) {
    if (config) this.configure(config);
  }

  /** Information about the current session, or `undefined` when logged out. */
  get sessionInfo(): SessionInfo | undefined {
    return this.session?.info;
  }

  /**
   * Opens a session. The configuration is merged with the previous one,
   * so `createSession()` without argument simply logs in again.
   */
  async createSession(config?: ServiceLayerConfig): Promise<SessionInfo> {
    if (config) this.configure({ ...this.userConfig, ...config });
    this.session = undefined;
    const session = await this.login();
    return session.info;
  }

  /** Renews the session if it is missing or about to expire. */
  async refreshSession(): Promise<void> {
    await this.ensureSession();
  }

  /** Closes the session on the server. The local session is cleared in any case. */
  async logout(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (!session) return;
    try {
      await this.requireHttp().post('Logout', undefined, {
        headers: { Cookie: session.cookie }
      });
      this.log('Session closed');
    } catch (error) {
      throw ServiceLayerError.from(error, 'post', 'Logout');
    }
  }

  /** GET a resource, e.g. `Orders(10)` or `Orders?$top=5`. */
  get<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('get', path, undefined, options);
  }

  /** Alias of {@link ServiceLayer.get}, kept for compatibility. */
  query<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.get<T>(path, options);
  }

  /** Fetches every page of a collection by following the OData `nextLink`. */
  async find<T = unknown>(path: string, options: FindOptions = {}): Promise<T[]> {
    const { maxPages = Infinity, ...requestOptions } = options;
    // The nextLink already contains the query string: params must not be sent twice.
    const nextOptions: RequestOptions = { ...requestOptions, params: undefined };

    const items: T[] = [];
    const visited = new Set<string>();
    let page = await this.get<ODataCollection<T> | undefined>(path, requestOptions);

    for (let count = 1; ; count++) {
      if (!page || !Array.isArray(page.value)) {
        throw new ServiceLayerError(`GET ${path} did not return a collection`, {
          kind: 'client',
          method: 'get',
          path
        });
      }
      items.push(...page.value);

      const next = page['@odata.nextLink'] ?? page['odata.nextLink'];
      if (!next || count >= maxPages) return items;
      if (visited.has(next)) {
        throw new ServiceLayerError(`Pagination loop detected on ${next}`, {
          kind: 'client',
          method: 'get',
          path: next
        });
      }
      visited.add(next);
      page = await this.get<ODataCollection<T> | undefined>(next, nextOptions);
    }
  }

  /** Creates a resource. */
  post<T = unknown>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('post', path, data, options);
  }

  /** Replaces a resource. */
  put<T = unknown>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('put', path, data, options);
  }

  /** Updates a resource partially. */
  patch<T = unknown>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('patch', path, data, options);
  }

  /** Deletes a resource. */
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('delete', path, undefined, options);
  }

  /** Sends an authenticated request to the Service Layer. */
  async request<T = unknown>(
    method: Method,
    path: string,
    data?: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    const config = this.requireConfig();
    const url = toRelativePath(path, config.version);

    for (let attempt = 1; ; attempt++) {
      const session = await this.ensureSession();
      this.log(`${method.toUpperCase()} ${url}`);
      try {
        const response = await this.requireHttp().request<T>({
          ...options,
          method,
          url,
          data,
          headers: AxiosHeaders.from(options.headers as AxiosHeaders).set('Cookie', session.cookie)
        });
        session.touch();
        return response.data;
      } catch (error) {
        if (attempt === 1 && axios.isAxiosError(error) && error.response?.status === 401) {
          this.log('Session rejected by the server (401), logging in again');
          // Another request may already have replaced the session.
          if (this.session === session) this.session = undefined;
          continue;
        }
        throw ServiceLayerError.from(error, method, url);
      }
    }
  }

  private configure(config: ServiceLayerConfig): void {
    for (const key of ['host', 'company', 'username', 'password'] as const) {
      if (typeof config[key] !== 'string' || config[key] === '') {
        throw new ServiceLayerError(`Missing configuration value: ${key}`, {
          kind: 'client'
        });
      }
    }

    const resolved: ResolvedConfig = {
      ...DEFAULTS,
      logger: console,
      ...stripUndefined(config),
      host: config.host,
      company: config.company,
      username: config.username,
      password: config.password,
      port: config.port === undefined ? DEFAULTS.port : config.port || null
    };

    this.userConfig = config;
    this.config = resolved;
    this.session = undefined;
    this.http = axios.create({
      baseURL: buildBaseUrl(resolved),
      timeout: resolved.timeout,
      httpsAgent: new https.Agent({
        rejectUnauthorized: resolved.rejectUnauthorized,
        keepAlive: true
      })
    });

    this.log('Configuration', { ...resolved, password: '***', logger: undefined });
  }

  private async ensureSession(): Promise<Session> {
    if (this.session && !this.session.isExpired()) return this.session;
    if (this.session) this.log('Session expired, logging in again');
    return this.login();
  }

  /** Logs in, sharing a single request between concurrent callers. */
  private login(): Promise<Session> {
    this.pendingLogin ??= this.doLogin().finally(() => {
      this.pendingLogin = undefined;
    });
    return this.pendingLogin;
  }

  private async doLogin(): Promise<Session> {
    const config = this.requireConfig();
    try {
      const response = await this.requireHttp().post<Partial<LoginResponse> | undefined>('Login', {
        CompanyDB: config.company,
        UserName: config.username,
        Password: config.password,
        ...(config.language !== undefined && { Language: config.language })
      });
      const login = response.data;
      if (typeof login?.SessionId !== 'string' || login.SessionId === '') {
        throw new ServiceLayerError('Login response does not contain a SessionId', {
          kind: 'http',
          method: 'post',
          path: 'Login',
          status: response.status
        });
      }
      const setCookie = response.headers['set-cookie'];
      const timeout = login.SessionTimeout;
      this.session = new Session(
        {
          ...login,
          SessionId: login.SessionId,
          // 30 minutes is the Service Layer default.
          SessionTimeout: typeof timeout === 'number' && timeout > 0 ? timeout : 30
        },
        config.company,
        setCookie
      );
      this.log(
        `Session opened (timeout ${this.session.info.timeoutMinutes} min, ` +
          `renewal at ${new Date(this.session.expiresAt).toISOString()})`
      );
      return this.session;
    } catch (error) {
      this.session = undefined;
      throw ServiceLayerError.from(error, 'post', 'Login');
    }
  }

  private requireConfig(): ResolvedConfig {
    if (!this.config) {
      throw new ServiceLayerError(
        'The client is not configured: call createSession(config) first',
        { kind: 'client' }
      );
    }
    return this.config;
  }

  private requireHttp(): AxiosInstance {
    this.requireConfig();
    return this.http as AxiosInstance;
  }

  private log(...args: unknown[]): void {
    if (this.config?.debug) this.config.logger.debug('[b1-service-layer]', ...args);
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
