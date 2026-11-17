/** Допоміжне для тестів: керований годинник і фейковий fetch з маршрутами */

import type { Clock } from './http';

export class FakeClock implements Clock {
  slept: number[] = [];
  constructor(public t = Date.parse('2026-10-29T10:00:00Z')) {}
  now() {
    return this.t;
  }
  async sleep(ms: number) {
    this.slept.push(ms);
    this.t += ms;
  }
}

export interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
}

type Handler = (call: Call) => Response | Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** fetch, що віддає відповіді маршрутів «METHOD /path» (шлях без /v2) і записує виклики */
export function fakeFetch(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    const path = url.pathname.replace(/^\/v2/, '');
    const route = [...queues.entries()].find(([k]) => {
      const [m, p] = k.split(' ');
      return m === call.method && new RegExp(`^${p!.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path);
    });
    if (!route) return new Response('not found', { status: 404 });
    const h = route[1];
    const handler = Array.isArray(h) ? (h.length > 1 ? h.shift()! : h[0]!) : h;
    return handler(call);
  }) as typeof fetch;
  return { fetch: fn, calls };
}
