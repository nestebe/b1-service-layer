// Read-only smoke test against a real Service Layer (no data is created or modified).
//
// Usage (after `npm run build`):
//   SL_HOST=https://my-server SL_COMPANY=SBODEMO SL_USER=manager SL_PASSWORD=*** node examples/smoke-test.mjs
// Optional: SL_PORT (default 50001, "0" for none), SL_VERSION (default v2).

import { ServiceLayer, ServiceLayerError } from '../dist/index.js';

const env = name => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};

const sl = new ServiceLayer({
  host: env('SL_HOST'),
  company: env('SL_COMPANY'),
  username: env('SL_USER'),
  password: env('SL_PASSWORD'),
  port: process.env.SL_PORT ? Number(process.env.SL_PORT) : undefined,
  version: process.env.SL_VERSION ?? 'v2',
  debug: true
});

try {
  const session = await sl.createSession();
  console.log('1. Login OK', { timeoutMinutes: session.timeoutMinutes, version: session.version });

  const single = await sl.get('Orders?$top=1&$select=DocEntry,DocNum');
  console.log('2. GET OK', single);

  const pages = await sl.find('Orders?$select=DocEntry', { maxPages: 2 });
  console.log(`3. find OK (${pages.length} orders over at most 2 pages)`);

  const error = await sl.get('Orders(-1)').catch(e => e);
  console.log(
    '4. Error handling OK',
    error instanceof ServiceLayerError ? { status: error.status, message: error.message } : error
  );

  await sl.logout();
  console.log('5. Logout OK');
} catch (error) {
  console.error('Smoke test failed:', error);
  process.exitCode = 1;
}
