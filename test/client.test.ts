import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import defaultInstance, {
  ServiceLayer,
  ServiceLayerError,
  type ServiceLayerConfig
} from '../src/index.js';
import { MockServiceLayer } from './mock-server.js';

let mock: MockServiceLayer;
let config: ServiceLayerConfig;

async function startMock(options?: ConstructorParameters<typeof MockServiceLayer>[0]) {
  mock = new MockServiceLayer(options);
  const port = await mock.start();
  config = {
    host: 'http://127.0.0.1/',
    port,
    version: mock.version,
    company: 'SBODEMO',
    username: 'manager',
    password: 'secret'
  };
}

async function catchError(promise: Promise<unknown>): Promise<ServiceLayerError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(ServiceLayerError);
  return error as ServiceLayerError;
}

afterEach(async () => {
  vi.useRealTimers();
  await mock.stop();
});

describe('session', () => {
  beforeEach(() => startMock({ routeId: '.node2' }));

  it('logs in with the configured credentials', async () => {
    const sl = new ServiceLayer();
    const info = await sl.createSession(config);

    expect(info).toEqual({ sessionId: 'session-1', timeoutMinutes: 30, version: '1000190' });
    expect(sl.sessionInfo).toEqual(info);
    expect(mock.requests[0]).toMatchObject({
      method: 'POST',
      url: '/b1s/v2/Login',
      body: { CompanyDB: 'SBODEMO', UserName: 'manager', Password: 'secret' }
    });
  });

  it('sends the session cookie, company and ROUTEID', async () => {
    const sl = new ServiceLayer(config);
    await sl.get('Orders(1)');

    expect(mock.requests.at(-1)?.cookie).toBe(
      'B1SESSION=session-1; CompanyDB=SBODEMO; ROUTEID=.node2'
    );
  });

  it('logs in lazily when constructed with a config', async () => {
    const sl = new ServiceLayer(config);
    expect(mock.loginCount).toBe(0);
    await sl.get('Orders(1)');
    expect(mock.loginCount).toBe(1);
  });

  it('rejects an incomplete configuration', () => {
    expect(() => new ServiceLayer({ ...config, password: '' })).toThrow(
      'Missing configuration value: password'
    );
  });

  it('fails clearly when used before createSession', async () => {
    const error = await catchError(new ServiceLayer().get('Orders'));
    expect(error.kind).toBe('client');
    expect(error.message).toContain('createSession');
  });

  it('throws on bad credentials without leaking the password', async () => {
    const sl = new ServiceLayer();
    const error = await catchError(sl.createSession({ ...config, password: 'wrong-pass' }));

    expect(error).toMatchObject({ kind: 'http', status: 401, code: 100000027, path: 'Login' });
    expect(error.message).toBe('POST Login failed with status 401: Login failed');
    expect(JSON.stringify(error)).not.toContain('wrong-pass');
    expect(mock.loginCount).toBe(0);
    expect(sl.sessionInfo).toBeUndefined();
  });

  it('renews the session after the inactivity timeout', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const sl = new ServiceLayer(config);
    await sl.get('Orders(1)');

    vi.setSystemTime(Date.now() + 28 * 60_000);
    await sl.get('Orders(1)');
    expect(mock.loginCount).toBe(1); // activity extends the session

    vi.setSystemTime(Date.now() + 29 * 60_000 + 1);
    await sl.get('Orders(1)');
    expect(mock.loginCount).toBe(2);
  });

  it('logs in again and replays the request once on 401', async () => {
    const sl = new ServiceLayer(config);
    await sl.get('Orders(1)');
    mock.dropSessions();

    await expect(sl.get('Orders(2)')).resolves.toMatchObject({ DocEntry: 2 });
    expect(mock.loginCount).toBe(2);
  });

  it('does not retry forever when 401 persists', async () => {
    const sl = new ServiceLayer(config);
    mock.alwaysUnauthorized = true;

    const error = await catchError(sl.get('Orders(1)'));
    expect(error).toMatchObject({ status: 401, code: 301 });
    expect(mock.loginCount).toBe(2);
  });

  it('shares a single login between concurrent requests', async () => {
    mock.loginDelay = 50;
    const sl = new ServiceLayer(config);
    await Promise.all([sl.get('Orders(1)'), sl.get('Orders(2)'), sl.get('Orders(3)')]);
    expect(mock.loginCount).toBe(1);
  });

  it('logs out and logs in again on the next request', async () => {
    const sl = new ServiceLayer(config);
    await sl.get('Orders(1)');
    await sl.logout();

    expect(sl.sessionInfo).toBeUndefined();
    expect(mock.sessions.size).toBe(0);
    await sl.get('Orders(1)');
    expect(mock.loginCount).toBe(2);
  });

  it('never logs the password in debug mode', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const sl = new ServiceLayer({ ...config, debug: true, logger });
    await sl.get('Orders(1)');

    expect(logger.debug).toHaveBeenCalled();
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('secret');
  });
});

describe('requests', () => {
  beforeEach(() => startMock());

  it('gets a resource', async () => {
    const sl = new ServiceLayer(config);
    await expect(sl.get('Orders(10)')).resolves.toEqual({ DocEntry: 10, DocNum: 1009 });
    await expect(sl.query('Orders(10)')).resolves.toEqual({ DocEntry: 10, DocNum: 1009 });
  });

  it('throws a ServiceLayerError with the server message', async () => {
    const sl = new ServiceLayer(config);
    const error = await catchError(sl.get('Orders(999)'));

    expect(error).toMatchObject({
      kind: 'http',
      method: 'get',
      path: 'Orders(999)',
      status: 404,
      code: -2028
    });
    expect(error.message).toBe(
      'GET Orders(999) failed with status 404: No matching records found (ODBC -2028)'
    );
  });

  it('creates, updates and deletes', async () => {
    const sl = new ServiceLayer(config);
    await expect(sl.post('Orders', { CardCode: 'C001' })).resolves.toEqual({
      DocEntry: 46,
      CardCode: 'C001'
    });
    await expect(sl.patch('Orders(1)', { Comments: 'x' })).resolves.toBe('');
    await expect(sl.put('Orders(1)', { Comments: 'x' })).resolves.toBe('');
    await expect(sl.delete('Orders(1)')).resolves.toBe('');

    expect(mock.requests.slice(-4).map(r => `${r.method} ${r.url}`)).toEqual([
      'POST /b1s/v2/Orders',
      'PATCH /b1s/v2/Orders(1)',
      'PUT /b1s/v2/Orders(1)',
      'DELETE /b1s/v2/Orders(1)'
    ]);
  });

  it('keeps custom headers and forwards axios options', async () => {
    const sl = new ServiceLayer(config);
    await sl.get('Orders', { headers: { Prefer: 'odata.maxpagesize=5' }, params: { $top: 1 } });
    expect(mock.requests.at(-1)?.url).toBe('/b1s/v2/Orders?$top=1');
  });

  it('reports network errors', async () => {
    const sl = new ServiceLayer(config);
    await mock.stop();
    const error = await catchError(sl.get('Orders(1)'));
    expect(error.kind).toBe('network');
    await mock.start();
  });
});

describe('find', () => {
  it('follows @odata.nextLink (v2)', async () => {
    await startMock();
    const sl = new ServiceLayer(config);
    const orders = await sl.find<{ DocEntry: number }>('Orders');

    expect(orders).toHaveLength(45);
    expect(orders.map(o => o.DocEntry)).toEqual(mock.orders.map(o => o.DocEntry));
  });

  it('follows odata.nextLink with the /b1s/v1/ prefix (v1)', async () => {
    await startMock({ version: 'v1' });
    const sl = new ServiceLayer(config);
    const orders = await sl.find('Orders');

    expect(orders).toHaveLength(45);
    expect(mock.requests.filter(r => r.url.includes('/b1s/v1/b1s/'))).toEqual([]);
  });

  it('does not send params twice when following nextLink', async () => {
    await startMock();
    const sl = new ServiceLayer(config);
    await sl.find('Orders', { params: { $filter: "DocumentStatus eq 'bost_Open'" } });

    const urls = mock.requests.filter(r => r.method === 'GET').map(r => decodeURIComponent(r.url));
    expect(urls).toHaveLength(3);
    for (const url of urls) expect(url.match(/\$filter/g)).toHaveLength(1);
  });

  it('stops after maxPages', async () => {
    await startMock();
    const sl = new ServiceLayer(config);
    await expect(sl.find('Orders', { maxPages: 2 })).resolves.toHaveLength(40);
  });

  it('rejects a response that is not a collection', async () => {
    await startMock();
    const sl = new ServiceLayer(config);
    const error = await catchError(sl.find('Orders(1)'));
    expect(error.kind).toBe('client');
  });
});

describe('default export', () => {
  beforeEach(() => startMock());

  it('is a shared ServiceLayer instance (1.x usage)', async () => {
    expect(defaultInstance).toBeInstanceOf(ServiceLayer);
    await defaultInstance.createSession(config);
    await expect(defaultInstance.get('Orders(1)')).resolves.toMatchObject({ DocEntry: 1 });
    await defaultInstance.logout();
  });
});
