import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Also protect localhost from cross-site requests and DNS rebinding. */
export function secureApi(app: FastifyInstance, apiToken: string): void {
  app.addHook('onRequest', async (req, reply) => {
    let host: URL;
    try {
      host = new URL(`http://${req.headers.host ?? ''}`);
    } catch {
      return reply.code(400).send({ error: 'Invalid Host header' });
    }
    if (!apiToken && !loopback.has(host.hostname)) {
      return reply.code(403).send({ error: 'Local access requires a localhost Host header' });
    }

    if (req.headers.origin) {
      let allowed = false;
      try {
        const origin = new URL(req.headers.origin);
        allowed = ['http:', 'https:'].includes(origin.protocol) && (
          origin.host === host.host ||
          (loopback.has(host.hostname) && loopback.has(origin.hostname) && origin.port === '5310')
        );
      } catch { /* invalid or opaque origin */ }
      if (!allowed) return reply.code(403).send({ error: 'Cross-origin requests are not allowed' });
    } else if (req.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: 'Cross-site requests are not allowed' });
    }

    // Use the matched route, since the raw URL may contain encoded characters.
    const route = req.routeOptions.url;
    if (!apiToken || !route?.startsWith('/api/')) return;
    // EventSource cannot send custom headers; query keys are accepted only here.
    const key = req.headers['x-api-key'] ??
      (route === '/api/events' ? (req.query as Record<string, string>)?.key : undefined);
    const given = Buffer.from(typeof key === 'string' ? key : '');
    const expected = Buffer.from(apiToken);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return reply.code(401).send({ error: 'Ungültiger oder fehlender API-Schlüssel (x-api-key)' });
    }
  });
}
