import { describe, expect, it } from 'vitest';

import { parseServiceLayerBody } from '../src/errors.js';
import { Session } from '../src/session.js';
import type { ResolvedConfig } from '../src/types.js';
import { buildBaseUrl, toRelativePath } from '../src/url.js';

const base: ResolvedConfig = {
  host: 'https://sap',
  port: 50001,
  version: 'v2',
  company: 'C',
  username: 'u',
  password: 'p',
  rejectUnauthorized: false,
  timeout: 0,
  debug: false,
  logger: console
};

describe('buildBaseUrl', () => {
  it('adds port and version', () => {
    expect(buildBaseUrl(base)).toBe('https://sap:50001/b1s/v2/');
  });

  it('removes trailing slashes and omits a null port', () => {
    expect(buildBaseUrl({ ...base, host: 'https://sap.example.com//', port: null })).toBe(
      'https://sap.example.com/b1s/v2/'
    );
  });
});

describe('toRelativePath', () => {
  it.each([
    ['Orders?$skip=20', 'Orders?$skip=20'],
    ['/Orders(1)', 'Orders(1)'],
    ['/b1s/v1/Orders?$skip=20', 'Orders?$skip=20'],
    ['b1s/v1/Orders?$skip=20', 'Orders?$skip=20'],
    ['https://sap:50000/b1s/v1/Orders?$skip=20', 'Orders?$skip=20']
  ])('%s -> %s', (input, expected) => {
    expect(toRelativePath(input, 'v1')).toBe(expected);
  });
});

describe('parseServiceLayerBody', () => {
  it('reads v1 errors', () => {
    expect(
      parseServiceLayerBody({ error: { code: -10, message: { lang: 'en-us', value: 'Boom' } } })
    ).toEqual({ code: -10, message: 'Boom' });
  });

  it('reads v2 errors', () => {
    expect(parseServiceLayerBody({ error: { code: '301', message: 'Invalid session' } })).toEqual({
      code: '301',
      message: 'Invalid session'
    });
  });

  it('ignores other bodies', () => {
    expect(parseServiceLayerBody('<html>')).toEqual({});
  });
});

describe('Session', () => {
  it('expires one minute before the server timeout and is extended by activity', () => {
    const session = new Session({ SessionId: 'id', SessionTimeout: 30 }, 'C', undefined, 0);
    expect(session.expiresAt).toBe(29 * 60_000);
    expect(session.isExpired(29 * 60_000 - 1)).toBe(false);
    expect(session.isExpired(29 * 60_000)).toBe(true);

    session.touch(10 * 60_000);
    expect(session.isExpired(29 * 60_000)).toBe(false);
  });

  it('keeps half of very short timeouts', () => {
    const session = new Session({ SessionId: 'id', SessionTimeout: 1 }, 'C', undefined, 0);
    expect(session.expiresAt).toBe(30_000);
  });
});
