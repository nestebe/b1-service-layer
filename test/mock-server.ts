import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  cookie?: string;
  body?: unknown;
}

export interface MockOptions {
  version?: 'v1' | 'v2';
  sessionTimeout?: number;
  routeId?: string;
}

/**
 * Minimal in-memory imitation of the SAP B1 Service Layer:
 * Login/Logout, cookie-based sessions, paginated `Orders`, CRUD on `Orders(n)`.
 */
export class MockServiceLayer {
  readonly requests: RecordedRequest[] = [];
  readonly sessions = new Set<string>();
  loginCount = 0;
  /** Delay applied to Login responses, in ms. */
  loginDelay = 0;
  orders = Array.from({ length: 45 }, (_, i) => ({ DocEntry: i + 1, DocNum: 1000 + i }));
  pageSize = 20;
  /** When true, every authenticated request is rejected with 401. */
  alwaysUnauthorized = false;

  private server?: Server;
  private nextSession = 1;

  constructor(private readonly options: MockOptions = {}) {}

  get version(): 'v1' | 'v2' {
    return this.options.version ?? 'v2';
  }

  async start(): Promise<number> {
    const server = createServer((req, res) => {
      void this.handle(req).then(({ status, body, headers }) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(body === undefined ? undefined : JSON.stringify(body));
      });
    });
    this.server = server;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise(resolve => this.server?.close(resolve));
  }

  /** Simulates a server-side session loss (restart, timeout...). */
  dropSessions(): void {
    this.sessions.clear();
  }

  private async handle(req: IncomingMessage): Promise<{
    status: number;
    body?: unknown;
    headers?: Record<string, string | string[]>;
  }> {
    const raw = await readBody(req);
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    const prefix = `/b1s/${this.version}/`;
    const fullUrl = req.url ?? '';
    this.requests.push({
      method: req.method ?? '',
      url: fullUrl,
      cookie: req.headers.cookie,
      body
    });

    if (!fullUrl.startsWith(prefix)) return error(404, -1, `Unknown path ${fullUrl}`);
    const url = new URL(fullUrl.slice(prefix.length), 'http://x/');
    const resource = url.pathname.slice(1);

    if (resource === 'Login' && req.method === 'POST') {
      await new Promise(resolve => setTimeout(resolve, this.loginDelay));
      const credentials = body as Record<string, string>;
      if (credentials.Password !== 'secret') return error(401, 100000027, 'Login failed');
      this.loginCount++;
      const id = `session-${this.nextSession++}`;
      this.sessions.add(id);
      const cookies = [`B1SESSION=${id}; path=/b1s; HttpOnly`];
      if (this.options.routeId) cookies.push(`ROUTEID=${this.options.routeId}; path=/b1s`);
      return {
        status: 200,
        headers: { 'Set-Cookie': cookies },
        body: {
          SessionId: id,
          Version: '1000190',
          SessionTimeout: this.options.sessionTimeout ?? 30
        }
      };
    }

    const session = /B1SESSION=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (!session || !this.sessions.has(session) || this.alwaysUnauthorized) {
      return error(401, 301, 'Invalid session or session already timeout.');
    }

    if (resource === 'Logout' && req.method === 'POST') {
      this.sessions.delete(session);
      return { status: 204 };
    }

    if (resource === 'Orders' && req.method === 'GET') {
      const skip = Number(url.searchParams.get('$skip') ?? 0);
      const filter = url.searchParams.get('$filter');
      const value = this.orders.slice(skip, skip + this.pageSize);
      const result: Record<string, unknown> = { value };
      if (skip + this.pageSize < this.orders.length) {
        const query = new URLSearchParams();
        if (filter) query.set('$filter', filter);
        query.set('$skip', String(skip + this.pageSize));
        const next = `Orders?${query.toString()}`;
        if (this.version === 'v1') result['odata.nextLink'] = `/b1s/v1/${next}`;
        else result['@odata.nextLink'] = next;
      }
      return { status: 200, body: result };
    }

    if (resource === 'Orders' && req.method === 'POST') {
      const order = { DocEntry: this.orders.length + 1, ...(body as object) };
      return { status: 201, body: order };
    }

    const match = /^Orders\((\d+)\)$/.exec(resource);
    if (match) {
      const entry = Number(match[1]);
      const order = this.orders.find(o => o.DocEntry === entry);
      if (!order) return error(404, -2028, 'No matching records found (ODBC -2028)');
      if (req.method === 'GET') return { status: 200, body: order };
      if (req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE') {
        return { status: 204 };
      }
    }

    return error(404, -1, `Resource not found for the segment '${resource}'`);
  }
}

function error(status: number, code: number, message: string) {
  return { status, body: { error: { code, message } } };
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) data += String(chunk);
  return data;
}
