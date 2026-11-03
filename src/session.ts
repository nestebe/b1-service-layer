import type { LoginResponse, SessionInfo } from './types.js';

/** Safety margin before the server-side inactivity timeout. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * State of an authenticated Service Layer session.
 *
 * The Service Layer timeout is an inactivity timeout: every successful request
 * extends it, so `touch()` is called after each response.
 */
export class Session {
  readonly info: SessionInfo;
  readonly cookie: string;
  private readonly ttlMs: number;
  private lastActivity: number;

  constructor(
    login: LoginResponse,
    company: string,
    setCookie: string[] | undefined,
    now = Date.now()
  ) {
    this.info = {
      sessionId: login.SessionId,
      timeoutMinutes: login.SessionTimeout,
      version: login.Version
    };
    this.cookie = buildCookie(login.SessionId, company, setCookie);
    const timeoutMs = login.SessionTimeout * 60_000;
    this.ttlMs = Math.max(timeoutMs - EXPIRY_MARGIN_MS, timeoutMs / 2);
    this.lastActivity = now;
  }

  get expiresAt(): number {
    return this.lastActivity + this.ttlMs;
  }

  isExpired(now = Date.now()): boolean {
    return now >= this.expiresAt;
  }

  touch(now = Date.now()): void {
    this.lastActivity = now;
  }
}

/**
 * Builds the `Cookie` header. `ROUTEID` is forwarded when the Service Layer runs
 * behind its load balancer, otherwise requests may reach a node without the session.
 */
function buildCookie(sessionId: string, company: string, setCookie: string[] | undefined): string {
  const cookies = [`B1SESSION=${sessionId}`, `CompanyDB=${company}`];
  const routeId = setCookie
    ?.map(cookie => /^\s*ROUTEID=([^;]*)/i.exec(cookie)?.[1])
    .find(value => value !== undefined);
  if (routeId) cookies.push(`ROUTEID=${routeId}`);
  return cookies.join('; ');
}
