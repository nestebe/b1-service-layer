# b1-service-layer

TypeScript client for the SAP Business One Service Layer API.

- Typed API, ESM and CommonJS builds
- Automatic login, session renewal before timeout, and re-login + single replay on `401`
- Concurrent requests share a single login
- Automatic pagination (`@odata.nextLink` in v2, `odata.nextLink` in v1)
- One error type, `ServiceLayerError`, that never contains your password or session cookie
- `ROUTEID` cookie support for load-balanced Service Layer installations

Requires Node.js 20 or later.

## Installation

```sh
npm i b1-service-layer
```

## Usage

```ts
import { ServiceLayer } from 'b1-service-layer';

const sl = new ServiceLayer({
  host: 'https://my-server',
  company: 'SBODEMO',
  username: 'manager',
  password: 'secret'
  // port: 50001,               // default; null or 0 when the port is in host / behind a proxy
  // version: 'v2',             // default; 'v1' also supported
  // language: 22,              // B1 language code sent at login
  // rejectUnauthorized: false, // default; set true when the TLS certificate is trusted
  // timeout: 0,                // request timeout in ms, 0 = none
  // debug: false,              // log requests and session events
  // logger: console            // any object with debug/warn/error
});

// Optional: the session is opened on the first request anyway.
await sl.createSession();
```

The 1.x style still works with the shared default instance:

```js
import sl from 'b1-service-layer';

await sl.createSession(config);
```

### Reading

```ts
interface Order {
  DocEntry: number;
  DocNum: number;
  CardCode: string;
}

// A single entity
const order = await sl.get<Order>('Orders(100)');

// One page of a collection (raw OData response)
const page = await sl.get<{ value: Order[] }>("Orders?$filter=DocumentStatus eq 'bost_Open'");

// Query parameters can also be passed as axios options
const top = await sl.get('Orders', { params: { $top: 5, $select: 'DocEntry,DocNum' } });

// Every page of a collection, following nextLink
const all = await sl.find<Order>('Orders', {
  params: { $filter: "DocumentStatus eq 'bost_Open'" }
});

// Limit the number of pages
const firstPages = await sl.find<Order>('Orders', { maxPages: 3 });
```

Every method accepts axios request options as its last argument (`params`, `headers`, `timeout`, `signal`...). For instance, to get bigger pages:

```ts
await sl.find('Orders', { headers: { Prefer: 'odata.maxpagesize=100' } });
```

### Writing

```ts
const created = await sl.post<Order>('Orders', {
  CardCode: 'C001',
  DocDueDate: '2026-12-01',
  DocumentLines: [{ ItemCode: 'A001', Quantity: 1 }]
});

await sl.patch(`Orders(${created.DocEntry})`, { Comments: 'Updated' }); // partial update
await sl.put('Items(\'A001\')', item); // full replacement
await sl.delete('Items(\'A001\')');
await sl.post('Orders(100)/Close'); // actions

// Any other method
await sl.request('post', 'SQLQueries(\'q1\')/List', undefined, { params: { ... } });
```

### Session

```ts
sl.sessionInfo; // { sessionId, timeoutMinutes, version } or undefined
await sl.logout(); // the next request will log in again
```

The Service Layer timeout is an inactivity timeout. The client renews the session one minute before it expires, and if the server still rejects the session (restart, manual logout...) it logs in again and replays the request once.

### Errors

Every method throws a `ServiceLayerError`:

```ts
import { ServiceLayerError } from 'b1-service-layer';

try {
  await sl.get('Orders(999999)');
} catch (error) {
  if (error instanceof ServiceLayerError) {
    error.kind; // 'http' | 'network' | 'client'
    error.status; // 404
    error.code; // -2028 (Service Layer error code)
    error.message; // 'GET Orders(999999) failed with status 404: No matching records found (ODBC -2028)'
    error.body; // raw response body
  }
}
```

## Migrating from 1.x

| 1.x                                                                            | 2.x                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `get`, `post`, `put`, `patch` returned `{ error: true, message }`              | They throw a `ServiceLayerError`                        |
| Errors were printed with `console.error`                                       | Nothing is printed; use `debug: true` for request logs  |
| `debug: true` printed the configuration with the password                      | The password is masked                                  |
| `find` ignored its options on the first page and resent `params` on next pages | Options apply to every page, `params` only to the first |
| v1 pagination (`odata.nextLink`) was not followed                              | Followed                                                |
| `axios.defaults.withCredentials` was modified globally                         | The global axios instance is left untouched             |
| No minimum Node.js version declared                                            | Node.js >= 20                                           |
| No `delete`, `logout`                                                          | Available                                               |

Code that checked `result.error` must now use `try/catch`:

```js
// 1.x
const order = await sl.get('Orders(1)');
if (order.error) console.log(order.message);

// 2.x
try {
  const order = await sl.get('Orders(1)');
} catch (error) {
  console.log(error.message, error.body);
}
```

## Development

```sh
npm install
npm run check   # typecheck, lint, format check, tests
npm run build   # dist/ (ESM + CJS + types)
```

Tests run against an in-memory imitation of the Service Layer (`test/mock-server.ts`); no SAP server is required.
To check a real server without modifying any data:

```sh
npm run build
SL_HOST=https://my-server SL_COMPANY=SBODEMO SL_USER=manager SL_PASSWORD=*** node examples/smoke-test.mjs
```

### Releasing

Releases are published to npm by GitHub Actions (`.github/workflows/publish.yml`) with npm trusted publishing:

1. Bump `version` in `package.json` and update `CHANGELOG.md`, then merge into `master`.
2. Create a GitHub release with the tag `v<version>` (e.g. `v2.0.0`).
3. The workflow checks that the tag matches `package.json`, runs all checks and publishes.

## License

MIT
